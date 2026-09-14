"use client";

import { useState } from "react";

import type { StreamEvent } from "@/lib/messages";

type Source = { heading: string; file: string; score: number };

// The two architectures side by side:
//   ask   — retrieve once, up front, then answer (Experiment 008)
//   agent — the model decides what to search for, and may search again (009)
const MODES = {
  ask: { path: "/api/ask", label: "one-shot RAG" },
  agent: { path: "/api/agent", label: "agent" },
} as const;

type Mode = keyof typeof MODES;

export default function Ask() {
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<Source[] | null>(null);
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("ask");
  const [trace, setTrace] = useState<string[]>([]);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (question.trim() === "" || asking) return;

    setAsking(true);
    setError(null);
    setSources(null);
    setAnswer("");
    setTrace([]);

    const response = await fetch(MODES[mode].path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? `Request failed with ${response.status}`);
      setAsking(false);
      return;
    }

    // Same NDJSON reader as chat.tsx — buffer the tail, parse whole lines only.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") continue;
        const event = JSON.parse(line) as StreamEvent;

        if (event.type === "sources") {
          // Arrives before the model is called, so the retrieved passages are
          // visible even when generation fails.
          setSources(event.sources);
        } else if (event.type === "text") {
          text += event.text;
          setAnswer(text);
        } else if (event.type === "tool_use") {
          setTrace((p) => [...p, `→ ${event.name}(${JSON.stringify(event.input)})`]);
        } else if (event.type === "tool_result") {
          setTrace((p) => [
            ...p,
            `${event.is_error ? "✗" : "←"} ${event.name}: ${event.output.slice(0, 90)}…`,
          ]);
        } else if (event.type === "step") {
          setTrace((p) => [...p, `— step ${event.index} complete`]);
        } else if (event.type === "stopped") {
          setTrace((p) => [...p, `■ ${event.detail}`]);
        } else if (event.type === "error") {
          setError(event.error);
        }
      }
    }

    setAsking(false);
  }

  return (
    <section className="flex w-full flex-col gap-3 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <h2 className="text-sm font-medium text-zinc-500">
        Ask the notebook
      </h2>

      <form onSubmit={run} className="flex gap-2">
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as Mode)}
          className="rounded border border-zinc-300 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {Object.entries(MODES).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. why did my system prompt end up in the browser bundle"
          className="flex-1 rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={asking}
          className="rounded border border-zinc-300 px-4 py-2 disabled:opacity-50 dark:border-zinc-700"
        >
          {asking ? "Asking…" : "Ask"}
        </button>
      </form>

      {sources && (
        <ol className="flex flex-col gap-1 text-xs text-zinc-500">
          {sources.map((source, index) => (
            <li key={index}>
              <span className="font-mono">[{index + 1}] {source.score.toFixed(3)}</span>{" "}
              {source.file} — {source.heading.split(" > ").slice(-1)[0]}
            </li>
          ))}
        </ol>
      )}

      {trace.length > 0 && (
        <ul className="rounded border border-zinc-300 p-3 font-mono text-xs text-zinc-500 dark:border-zinc-700">
          {trace.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}

      {answer !== "" && <p className="whitespace-pre-wrap">{answer}</p>}

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
