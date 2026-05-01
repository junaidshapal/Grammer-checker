# AI Grammar Checker

A full-stack web app that detects grammar mistakes, suggests corrections, and visualizes writing analytics. Pure-Python AI (no Java required).

## Tech stack

- **Frontend:** Next.js 14 (App Router) + Tailwind CSS + Recharts
- **Backend:** FastAPI + HuggingFace Transformers (T5)
- **Model:** `vennify/t5-base-grammar-correction` (~890 MB, downloaded once)

## Features

- Detects grammar issues and suggests corrections
- Highlights incorrect words inline (red wavy underline)
- Per-suggestion **Apply / Dismiss** with live-rebuilt corrected text
- **Recharts** analytics: error-type donut, readability gauge, errors-per-sentence bar chart
- Readability stats (word count, sentences, reading time, Flesch Reading Ease)
- **Dark mode** toggle (persisted)
- Sample texts, copy & download corrected text, `Ctrl+Enter` submit
- Handles long multi-paragraph input via sentence-level chunking

## Project structure

```
.
├── backend/
│   ├── main.py              FastAPI app + /check-grammar endpoint
│   └── requirements.txt
└── frontend/
    ├── package.json
    ├── tailwind.config.ts
    ├── next.config.mjs
    ├── tsconfig.json
    └── app/
        ├── layout.tsx
        ├── page.tsx
        └── globals.css
```

## Setup

### Backend (Python 3.10+)

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The first request downloads the T5 model (~890 MB) into `~/.cache/huggingface`. Subsequent runs load from cache.

### Frontend (Node 18+)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.

## API

`POST /check-grammar`

```json
{ "text": "She go to school every day." }
```

Response:

```json
{
  "original": "...",
  "corrected": "...",
  "matches": [
    {
      "message": "Replace 'go' with 'goes'.",
      "replacements": ["goes"],
      "offset": 4,
      "length": 2,
      "rule_id": "AI_GRAMMAR",
      "category": "Grammar",
      "incorrect_text": "go",
      "context": "She go to school..."
    }
  ],
  "stats": {
    "char_count": 27,
    "word_count": 6,
    "sentence_count": 1,
    "avg_word_length": 3.7,
    "reading_time_minutes": 0.03,
    "flesch_reading_ease": 100.0,
    "readability_grade": "Very Easy"
  }
}
```

## Notes

- Long inputs are split into ~96-token chunks server-side so output isn't truncated.
- Model runs on CPU; expect 1–3 s per chunk on a typical i5.
- RAM at runtime: ~1.2–1.5 GB.
