"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Match = {
  message: string;
  short_message: string | null;
  replacements: string[];
  offset: number;
  length: number;
  rule_id: string;
  category: string;
  context: string;
  incorrect_text: string;
};

type Stats = {
  char_count: number;
  word_count: number;
  sentence_count: number;
  avg_word_length: number;
  reading_time_minutes: number;
  flesch_reading_ease: number | null;
  readability_grade: string;
};

type GrammarResponse = {
  original: string;
  corrected: string;
  matches: Match[];
  stats: Stats;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const SAMPLES: Record<string, string> = {
  Email:
    "Hi Sarah,\n\nI hope this email find you well. I wanted to follow up on the meeting we had last weeks. Could you sends me the documents we discussed? I really apreciate it.\n\nBest,\nAlex",
  Essay:
    "The internet have changed our lifes in many ways. People can now communicate instantly, accessing information from anywhere, and shares ideas globally. However, it also brings challenge that we needs to address carefully.",
  Casual:
    "yo dude how was you weekend? me and my brother went to the park and we seen lot of dogs. it was so fun lol cant wait to do it again",
};

// Colors used by the charts. Kept close to Tailwind palette.
const ERROR_TYPE_COLORS = {
  Replace: "#6366f1", // indigo-500
  Insert: "#10b981", // emerald-500
  Remove: "#f43f5e", // rose-500
};

// ---------------------------------------------------------------------------
// Helpers methods
// ---------------------------------------------------------------------------
function classifyMatch(m: Match): "Replace" | "Insert" | "Remove" {
  if (m.message.startsWith("Insert")) return "Insert";
  if (m.message.startsWith("Remove")) return "Remove";
  return "Replace";
}

function fleschColor(score: number | null): string {
  if (score === null) return "#94a3b8"; // slate-400
  if (score >= 70) return "#10b981"; // emerald
  if (score >= 60) return "#84cc16"; // lime
  if (score >= 50) return "#f59e0b"; // amber
  if (score >= 30) return "#f97316"; // orange
  return "#ef4444"; // red
}

/** Find sentence index (0-based) that contains a given char offset. */
function bucketMatchesBySentence(text: string, matches: Match[]) {
  // Compute sentence ranges using punctuation boundaries.
  const ranges: { start: number; end: number }[] = [];
  let prev = 0;
  const re = /[.!?]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ranges.push({ start: prev, end: m.index + m[0].length });
    prev = m.index + m[0].length;
  }
  if (prev < text.length) ranges.push({ start: prev, end: text.length });

  return ranges.map((r, i) => ({
    sentence: `S${i + 1}`,
    errors: matches.filter((mt) => mt.offset >= r.start && mt.offset < r.end).length,
  }));
}

export default function Home() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GrammarResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [dark, setDark] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ---- Theme ----
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }

  // ---- Live counters from textarea content ----
  const liveStats = useMemo(() => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const minutes = words.length / 200;
    return {
      chars: text.length,
      words: words.length,
      reading:
        words.length === 0
          ? "0 min"
          : minutes < 1
            ? "<1 min"
            : `~${Math.ceil(minutes)} min`,
    };
  }, [text]);

  // ---- API call ----
  async function handleCheck() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setDismissed(new Set());
    try {
      const res = await fetch(`${API_URL}/check-grammar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Request failed (${res.status})`);
      }
      const data: GrammarResponse = await res.json();
      setResult(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not reach the backend."
      );
    } finally {
      setLoading(false);
    }
  }

  // ---- Rebuild corrected text from accepted matches only ----
  const interactiveCorrected = useMemo(() => {
    if (!result) return "";
    let out = result.original;
    const toApply = result.matches
      .map((m, i) => ({ m, i }))
      .filter(({ i }) => !dismissed.has(i))
      .sort((a, b) => b.m.offset - a.m.offset);
    for (const { m } of toApply) {
      const replacement = m.replacements[0] ?? "";
      out = out.slice(0, m.offset) + replacement + out.slice(m.offset + m.length);
    }
    return out;
  }, [result, dismissed]);

  // ---- Highlight segments for the original text ----
  const segments = useMemo(() => {
    if (!result) return null;
    const indexed = result.matches.map((m, i) => ({ ...m, idx: i }));
    const sorted = [...indexed].sort((a, b) => a.offset - b.offset);
    const parts: { text: string; matchIdx?: number; isOff?: boolean }[] = [];
    let cursor = 0;
    for (const m of sorted) {
      if (m.offset > cursor) {
        parts.push({ text: result.original.slice(cursor, m.offset) });
      }
      parts.push({
        text: result.original.slice(m.offset, m.offset + m.length),
        matchIdx: m.idx,
        isOff: dismissed.has(m.idx),
      });
      cursor = m.offset + m.length;
    }
    if (cursor < result.original.length) {
      parts.push({ text: result.original.slice(cursor) });
    }
    return parts;
  }, [result, dismissed]);

  // ---- Chart data ----
  const errorTypeData = useMemo(() => {
    if (!result) return [];
    const tally: Record<string, number> = { Replace: 0, Insert: 0, Remove: 0 };
    for (const m of result.matches) tally[classifyMatch(m)]++;
    return (Object.keys(tally) as (keyof typeof ERROR_TYPE_COLORS)[])
      .filter((k) => tally[k] > 0)
      .map((k) => ({ name: k, value: tally[k], color: ERROR_TYPE_COLORS[k] }));
  }, [result]);

  const errorsPerSentence = useMemo(() => {
    if (!result) return [];
    return bucketMatchesBySentence(result.original, result.matches);
  }, [result]);

  // ---- Actions ----
  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(interactiveCorrected);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDownload() {
    if (!result) return;
    const blob = new Blob([interactiveCorrected], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "corrected.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleDismiss(idx: number) {
    setDismissed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function loadSample(name: string) {
    setText(SAMPLES[name]);
    setResult(null);
    setError(null);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleCheck();
    }
  }

  const acceptedCount = result ? result.matches.length - dismissed.size : 0;
  const errorRate =
    result && result.stats.word_count > 0
      ? (result.matches.length / result.stats.word_count) * 100
      : 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      {/* Header */}
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 text-white shadow-md">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2z" />
              <path d="m9 8 2 2 4-4" />
            </svg>
          </div>
          <div>
            <h1 className="bg-gradient-to-r from-indigo-600 to-blue-500 bg-clip-text text-2xl font-bold text-transparent dark:from-indigo-400 dark:to-blue-300 sm:text-3xl">
              AI Grammar Checker
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-300 sm:text-sm">
              Paste your English text and get instant grammar feedback.
            </p>
          </div>
        </div>
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {dark ? (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </header>

      {/* Sample chips */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Try a sample:
        </span>
        {Object.keys(SAMPLES).map((name) => (
          <button
            key={name}
            onClick={() => loadSample(name)}
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-500 dark:hover:bg-slate-700 dark:hover:text-indigo-300"
          >
            {name}
          </button>
        ))}
        {text && (
          <button
            onClick={() => {
              setText("");
              setResult(null);
              setError(null);
            }}
            className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
          >
            Clear
          </button>
        )}
      </div>

      {/* Input card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type or paste your text here... (Ctrl + Enter to check)"
          className="h-44 w-full resize-y rounded-lg border border-slate-300 bg-slate-50 p-4 text-slate-800 placeholder-slate-400 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-500/30"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {liveStats.chars} chars · {liveStats.words} words · {liveStats.reading} read
          </span>
          <button
            onClick={handleCheck}
            disabled={loading || !text.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2 font-medium text-white shadow-sm transition hover:from-indigo-700 hover:to-blue-700 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 dark:disabled:from-slate-700 dark:disabled:to-slate-700"
          >
            {loading && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
              </svg>
            )}
            {loading ? "Checking..." : "Check Grammar"}
          </button>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <section key={result.original} className="stagger mt-6 space-y-5">
          {/* Summary banner */}
          <SummaryBanner
            errors={result.matches.length}
            words={result.stats.word_count}
            errorRate={errorRate}
          />

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Words" value={String(result.stats.word_count)} accent="indigo" />
            <StatCard label="Sentences" value={String(result.stats.sentence_count)} accent="sky" />
            <StatCard
              label="Reading time"
              value={
                result.stats.reading_time_minutes < 1
                  ? "<1 min"
                  : `${Math.ceil(result.stats.reading_time_minutes)} min`
              }
              accent="emerald"
            />
            <StatCard
              label="Readability"
              value={result.stats.readability_grade}
              subValue={
                result.stats.flesch_reading_ease !== null
                  ? `Flesch ${result.stats.flesch_reading_ease}`
                  : undefined
              }
              accent="amber"
            />
          </div>

          {/* Charts row */}
          <div className="grid gap-3 lg:grid-cols-3">
            <ChartCard
              title="Error breakdown"
              description="Replace / Insert / Remove operations"
            >
              <ErrorTypeDonut data={errorTypeData} dark={dark} />
            </ChartCard>
            <ChartCard
              title="Readability"
              description="Flesch Reading Ease (0–100)"
            >
              <ReadabilityGauge
                score={result.stats.flesch_reading_ease}
                grade={result.stats.readability_grade}
                dark={dark}
              />
            </ChartCard>
            <ChartCard
              title="Errors per sentence"
              description="Where issues cluster"
            >
              <ErrorsPerSentenceChart data={errorsPerSentence} dark={dark} />
            </ChartCard>
          </div>

          {/* Highlighted text */}
          <Card>
            <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
              Highlighted text
            </h2>
            {result.matches.length === 0 ? (
              <p className="rounded-lg bg-emerald-50 px-4 py-3 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                Looks good! No grammar issues found.
              </p>
            ) : (
              <p className="whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-slate-100">
                {segments?.map((seg, i) =>
                  seg.matchIdx !== undefined ? (
                    <span
                      key={i}
                      title={result.matches[seg.matchIdx].message}
                      className={
                        seg.isOff
                          ? "text-slate-400 line-through dark:text-slate-500"
                          : "rounded bg-red-100 px-0.5 text-red-700 underline decoration-red-400 decoration-wavy underline-offset-4 dark:bg-red-900/40 dark:text-red-300"
                      }
                    >
                      {seg.text}
                    </span>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )}
              </p>
            )}
          </Card>

          {/* Suggestions */}
          {result.matches.length > 0 && (
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                  Suggestions{" "}
                  <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                    ({acceptedCount} of {result.matches.length} applied)
                  </span>
                </h2>
                {dismissed.size > 0 && (
                  <button
                    onClick={() => setDismissed(new Set())}
                    className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Reset all
                  </button>
                )}
              </div>
              <ul className="space-y-3">
                {result.matches.map((m, i) => {
                  const isOff = dismissed.has(i);
                  const type = classifyMatch(m);
                  return (
                    <li
                      key={i}
                      className={`rounded-lg border p-4 transition ${
                        isOff
                          ? "border-slate-200 bg-slate-100 opacity-60 dark:border-slate-700 dark:bg-slate-900/40"
                          : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                            style={{ background: ERROR_TYPE_COLORS[type] }}
                          >
                            {type}
                          </span>
                          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            {m.incorrect_text || "—"}
                          </span>
                          <span className="text-slate-400 dark:text-slate-500">→</span>
                          <span className="flex flex-wrap gap-1">
                            {m.replacements.length > 0 ? (
                              m.replacements.map((r, j) => (
                                <span
                                  key={j}
                                  className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                >
                                  {r}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                No suggestion
                              </span>
                            )}
                          </span>
                        </div>
                        <button
                          onClick={() => toggleDismiss(i)}
                          className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                            isOff
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          }`}
                        >
                          {isOff ? "Apply" : "Dismiss"}
                        </button>
                      </div>
                      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                        {m.message}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {/* Corrected text */}
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                Corrected text
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={handleDownload}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Download
                </button>
              </div>
            </div>
            <p className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-4 leading-relaxed text-slate-800 dark:bg-emerald-900/20 dark:text-emerald-50">
              {interactiveCorrected}
            </p>
          </Card>
        </section>
      )}

      <footer className="mt-12 text-center text-xs text-slate-400 dark:text-slate-500">
        Built with Next.js, FastAPI, HuggingFace Transformers &amp; Recharts · Press Ctrl+Enter to check
      </footer>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      {children}
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {title}
      </h3>
      {description && (
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {description}
        </p>
      )}
      <div className="mt-3">{children}</div>
    </div>
  );
}

const STAT_COLORS: Record<string, string> = {
  indigo:
    "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30",
  sky: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30",
  emerald:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
  amber:
    "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
};

function StatCard({
  label,
  value,
  subValue,
  accent,
}: {
  label: string;
  value: string;
  subValue?: string;
  accent: "indigo" | "sky" | "emerald" | "amber";
}) {
  return (
    <div className={`rounded-xl p-4 shadow-sm ring-1 ${STAT_COLORS[accent]}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-80">
        {label}
      </div>
      <div className="mt-1 text-xl font-bold leading-tight">{value}</div>
      {subValue && <div className="mt-0.5 text-xs opacity-70">{subValue}</div>}
    </div>
  );
}

function SummaryBanner({
  errors,
  words,
  errorRate,
}: {
  errors: number;
  words: number;
  errorRate: number;
}) {
  const tone =
    errors === 0
      ? "good"
      : errorRate < 5
        ? "ok"
        : errorRate < 15
          ? "warn"
          : "bad";

  const palette = {
    good: {
      bg: "from-emerald-50 to-white dark:from-emerald-900/20 dark:to-slate-800",
      border: "border-emerald-200 dark:border-emerald-800/60",
      text: "text-emerald-700 dark:text-emerald-300",
      icon: "✓",
      title: "Looks great!",
      sub: `Found 0 issues in ${words} words.`,
    },
    ok: {
      bg: "from-sky-50 to-white dark:from-sky-900/20 dark:to-slate-800",
      border: "border-sky-200 dark:border-sky-800/60",
      text: "text-sky-700 dark:text-sky-300",
      icon: "ⓘ",
      title: `Found ${errors} minor issue${errors === 1 ? "" : "s"}`,
      sub: `${errorRate.toFixed(1)} per 100 words — review the suggestions below.`,
    },
    warn: {
      bg: "from-amber-50 to-white dark:from-amber-900/20 dark:to-slate-800",
      border: "border-amber-200 dark:border-amber-800/60",
      text: "text-amber-800 dark:text-amber-300",
      icon: "!",
      title: `Found ${errors} issues`,
      sub: `${errorRate.toFixed(1)} per 100 words — there's room to polish this.`,
    },
    bad: {
      bg: "from-rose-50 to-white dark:from-rose-900/20 dark:to-slate-800",
      border: "border-rose-200 dark:border-rose-800/60",
      text: "text-rose-700 dark:text-rose-300",
      icon: "!",
      title: `Found ${errors} issues`,
      sub: `${errorRate.toFixed(1)} per 100 words — this draft needs significant edits.`,
    },
  }[tone];

  return (
    <div
      className={`flex items-center gap-4 rounded-2xl border bg-gradient-to-r p-4 shadow-sm ${palette.bg} ${palette.border}`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${palette.text} bg-white/80 dark:bg-slate-900/60`}
      >
        {palette.icon}
      </div>
      <div className="min-w-0">
        <div className={`text-base font-semibold ${palette.text}`}>
          {palette.title}
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-400">
          {palette.sub}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------
function ChartTooltip({ active, payload }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: { name?: string; color?: string } }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-md dark:border-slate-700 dark:bg-slate-800">
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: p.color || p.payload?.color || "#64748b" }}
          />
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {p.name || p.payload?.name}:
          </span>
          <span className="text-slate-600 dark:text-slate-300">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function ErrorTypeDonut({
  data,
  dark,
}: {
  data: { name: string; value: number; color: string }[];
  dark: boolean;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        No errors detected.
      </div>
    );
  }

  return (
    <div>
      <div className="relative h-44 w-full">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={3}
              stroke="none"
              isAnimationActive
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {total}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            issues
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: d.color }}
            />
            <span className="text-slate-700 dark:text-slate-300">
              {d.name}{" "}
              <span className="text-slate-400 dark:text-slate-500">({d.value})</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadabilityGauge({
  score,
  grade,
  dark,
}: {
  score: number | null;
  grade: string;
  dark: boolean;
}) {
  if (score === null) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Need more text.
      </div>
    );
  }
  const clamped = Math.max(0, Math.min(100, score));
  const color = fleschColor(score);
  const data = [{ name: "Score", value: clamped, fill: color }];

  return (
    <div>
      <div className="relative h-44 w-full">
        <ResponsiveContainer>
          <RadialBarChart
            cx="50%"
            cy="80%"
            innerRadius="80%"
            outerRadius="120%"
            startAngle={180}
            endAngle={0}
            data={data}
          >
            <PolarAngleAxis
              type="number"
              domain={[0, 100]}
              angleAxisId={0}
              tick={false}
            />
            <RadialBar
              background={{ fill: dark ? "#334155" : "#e2e8f0" }}
              dataKey="value"
              cornerRadius={10}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center">
          <div className="text-2xl font-bold" style={{ color }}>
            {score}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {grade}
          </div>
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
        <span>0 hard</span>
        <span>100 easy</span>
      </div>
    </div>
  );
}

function ErrorsPerSentenceChart({
  data,
  dark,
}: {
  data: { sentence: string; errors: number }[];
  dark: boolean;
}) {
  if (data.length === 0 || data.every((d) => d.errors === 0)) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        No errors detected.
      </div>
    );
  }
  const tickColor = dark ? "#94a3b8" : "#64748b";
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer>
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
        >
          <XAxis
            dataKey="sentence"
            tick={{ fill: tickColor, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={data.length > 12 ? "preserveStartEnd" : 0}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: tickColor, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)" }}
          />
          <Bar dataKey="errors" fill="#6366f1" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
