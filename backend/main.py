"""
AI Grammar Checker — FastAPI backend.

Pure-Python implementation: uses a pre-trained T5 grammar-correction model
loaded via Hugging Face Transformers. No Java, no remote API, no rate limits.

The model (~890MB) is downloaded once on first request and cached to
~/.cache/huggingface, then runs offline forever after.
"""

# this is a script file for grammer checker
import difflib
import re
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM


MODEL_NAME = "vennify/t5-base-grammar-correction"


# ---------------------------------------------------------------------------
# Model — load once at startup, reuse for every request.
# ---------------------------------------------------------------------------
print(f"[grammar] Loading model: {MODEL_NAME}")
print("[grammar] First run will download ~890MB; this is a one-time step.")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)
model.eval()  # inference mode
print("[grammar] Model ready.")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class TextIn(BaseModel):
    text: str = Field(..., description="Text to check for grammar")


class Match(BaseModel):
    message: str
    short_message: Optional[str] = None
    replacements: list[str]
    offset: int
    length: int
    rule_id: str
    category: str
    context: str
    incorrect_text: str


class Stats(BaseModel):
    char_count: int
    word_count: int
    sentence_count: int
    avg_word_length: float
    reading_time_minutes: float
    flesch_reading_ease: Optional[float] = None
    readability_grade: str


class GrammarResponse(BaseModel):
    original: str
    corrected: str
    matches: list[Match]
    stats: Stats


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------
# T5 has a hard 512-token input limit. We chunk input by paragraph + sentence
# so long texts work — each chunk fits under the limit, and we stitch results.
_PARA_SPLIT_RE = re.compile(r"\n\s*\n")
_SENT_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+")
# Keep chunks small so the model reliably emits a full corrected output.
# This grammar T5 was trained on short examples and starts truncating its
# own output past ~100–150 tokens regardless of max_new_tokens.
_MAX_CHUNK_TOKENS = 96


def _chunk_sentences(sentences: list[str]) -> list[str]:
    """Group sentences into chunks that stay under the model's token budget."""
    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0
    for s in sentences:
        s_tokens = len(tokenizer.encode(s, add_special_tokens=False))
        if current and current_tokens + s_tokens > _MAX_CHUNK_TOKENS:
            chunks.append(" ".join(current))
            current = [s]
            current_tokens = s_tokens
        else:
            current.append(s)
            current_tokens += s_tokens
    if current:
        chunks.append(" ".join(current))
    return chunks


def _correct_chunk(chunk: str) -> str:
    """Run the T5 model on a single chunk."""
    prompt = "grammar: " + chunk
    inputs = tokenizer(prompt, return_tensors="pt", max_length=512, truncation=True)
    input_len = inputs["input_ids"].shape[1]
    # Output must be allowed to grow at least a bit past the input length —
    # corrections sometimes add words.
    out_budget = max(input_len + 32, 256)
    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=out_budget,
            num_beams=5,
            early_stopping=True,
        )
    return tokenizer.decode(output_ids[0], skip_special_tokens=True)


def correct_text(text: str) -> str:
    """
    Correct `text` of any length. Splits on blank lines into paragraphs,
    then on sentence boundaries within each paragraph, then groups
    sentences into chunks that fit the model's input window.
    """
    paragraphs = _PARA_SPLIT_RE.split(text)
    corrected_paragraphs: list[str] = []
    for para in paragraphs:
        if not para.strip():
            corrected_paragraphs.append(para)
            continue
        sentences = [s for s in _SENT_BOUNDARY_RE.split(para) if s.strip()]
        if not sentences:
            corrected_paragraphs.append(para)
            continue
        corrected_chunks = [_correct_chunk(c) for c in _chunk_sentences(sentences)]
        corrected_paragraphs.append(" ".join(corrected_chunks))
    return "\n\n".join(corrected_paragraphs)


_TOKEN_RE = re.compile(r"\S+|\s+")
_WORD_RE = re.compile(r"\b[\w']+\b")
_SENT_SPLIT_RE = re.compile(r"[.!?]+")
_VOWEL_GROUP_RE = re.compile(r"[aeiouy]+")


def _count_syllables(word: str) -> int:
    """Cheap heuristic: count vowel groups, drop a trailing silent 'e'."""
    word = re.sub(r"[^a-z]", "", word.lower())
    if not word:
        return 0
    syllables = len(_VOWEL_GROUP_RE.findall(word))
    if word.endswith("e") and syllables > 1:
        syllables -= 1
    return max(1, syllables)


def compute_stats(text: str) -> Stats:
    words = _WORD_RE.findall(text)
    word_count = len(words)
    sentence_count = sum(1 for s in _SENT_SPLIT_RE.split(text) if s.strip())
    avg_word_len = (sum(len(w) for w in words) / word_count) if word_count else 0.0
    # Average adult reading speed ≈ 200 words per minute.
    reading_time = round(word_count / 200, 2) if word_count else 0.0

    flesch: Optional[float] = None
    grade = "—"
    if word_count >= 5 and sentence_count >= 1:
        syllables = sum(_count_syllables(w) for w in words)
        flesch = round(
            206.835
            - 1.015 * (word_count / sentence_count)
            - 84.6 * (syllables / word_count),
            1,
        )
        if flesch >= 90:
            grade = "Very Easy"
        elif flesch >= 70:
            grade = "Easy"
        elif flesch >= 60:
            grade = "Standard"
        elif flesch >= 50:
            grade = "Fairly Difficult"
        elif flesch >= 30:
            grade = "Difficult"
        else:
            grade = "Very Difficult"

    return Stats(
        char_count=len(text),
        word_count=word_count,
        sentence_count=sentence_count,
        avg_word_length=round(avg_word_len, 1),
        reading_time_minutes=reading_time,
        flesch_reading_ease=flesch,
        readability_grade=grade,
    )


def derive_matches(original: str, corrected: str) -> list[Match]:
    """
    Word-level diff between original and corrected text. Each diff hunk
    becomes a Match with character offsets so the frontend can highlight it.
    """
    orig_tokens = [(m.group(), m.start(), m.end()) for m in _TOKEN_RE.finditer(original)]
    corr_tokens = [(m.group(), m.start(), m.end()) for m in _TOKEN_RE.finditer(corrected)]

    # Compare non-whitespace tokens for cleaner diffs, but remember their
    # positions in the original token list so we can recover char offsets.
    orig_words = [t[0] for t in orig_tokens if not t[0].isspace()]
    corr_words = [t[0] for t in corr_tokens if not t[0].isspace()]
    orig_word_to_token_idx = [i for i, t in enumerate(orig_tokens) if not t[0].isspace()]

    matches: list[Match] = []
    sm = difflib.SequenceMatcher(a=orig_words, b=corr_words, autojunk=False)

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue

        # Char offsets of the affected slice in the original text.
        if i1 < len(orig_words):
            start_offset = orig_tokens[orig_word_to_token_idx[i1]][1]
        else:
            start_offset = len(original)
        if i2 > i1 and i2 - 1 < len(orig_words):
            end_offset = orig_tokens[orig_word_to_token_idx[i2 - 1]][2]
        else:
            end_offset = start_offset

        incorrect = " ".join(orig_words[i1:i2])
        replacement = " ".join(corr_words[j1:j2])

        if tag == "delete":
            message = f"Remove '{incorrect}'."
        elif tag == "insert":
            message = f"Insert '{replacement}'."
        else:  # replace
            message = f"Replace '{incorrect}' with '{replacement}'."

        ctx_start = max(0, start_offset - 30)
        ctx_end = min(len(original), end_offset + 30)

        matches.append(
            Match(
                message=message,
                replacements=[replacement] if replacement else [],
                offset=start_offset,
                length=max(0, end_offset - start_offset),
                rule_id="AI_GRAMMAR",
                category="Grammar",
                context=original[ctx_start:ctx_end],
                incorrect_text=incorrect,
            )
        )

    return matches


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="AI Grammar Checker", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "ok", "service": "AI Grammar Checker", "model": MODEL_NAME}


@app.post("/check-grammar", response_model=GrammarResponse)
def check_grammar(payload: TextIn):
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    corrected = correct_text(payload.text)
    matches = derive_matches(payload.text, corrected)

    return GrammarResponse(
        original=payload.text,
        corrected=corrected,
        matches=matches,
        stats=compute_stats(payload.text),
    )
