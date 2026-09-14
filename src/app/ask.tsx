"use client";

import { useState } from "react";

import type { StreamEvent } from "@/lib/messages";

type Source = { heading: string; file: string; score: number };

export default function Ask() {
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<Source[] | null>(null);
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (question.trim() === "" || asking) return;

    setAsking(true);
    setError(null);
    setSources(null);
    setAnswer("");

    const response = await fetch("/api/ask", {
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

      {answer !== "" && <p className="whitespace-pre-wrap">{answer}</p>}

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
