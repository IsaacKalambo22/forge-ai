"use client";

import { useState } from "react";

import type { StreamEvent } from "@/lib/messages";
import { readNdjsonStream } from "@/lib/ndjson";

import { Button, ErrorState, Input, Select } from "@/components/ui";

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
    // Experiment 021: the shared NDJSON reader (src/lib/ndjson.ts).
    let text = "";

    await readNdjsonStream<StreamEvent>(response.body, (event) => {
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
    });

    setAsking(false);
  }

  return (
    <section className="flex w-full flex-col gap-3 border-t border-border pt-8">
      <h2 className="text-sm font-semibold text-foreground">Ask the notebook</h2>

      <form onSubmit={run} className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor="ask-mode" className="text-sm text-muted-foreground">
            Mode
          </label>
          <Select
            id="ask-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as Mode)}
          >
            {Object.entries(MODES).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. why did my system prompt end up in the browser bundle"
          className="flex-1"
        />
        <Button type="submit" variant="secondary" disabled={asking}>
          {asking ? "Asking…" : "Ask"}
        </Button>
      </form>

      {sources && (
        <ol className="flex flex-col gap-1 text-xs text-muted-foreground">
          {sources.map((source, index) => (
            <li key={index}>
              <span className="font-mono">[{index + 1}] {source.score.toFixed(3)}</span>{" "}
              {source.file} — {source.heading.split(" > ").slice(-1)[0]}
            </li>
          ))}
        </ol>
      )}

      {trace.length > 0 && (
        <ul className="rounded-md border border-border bg-surface p-3 font-mono text-xs text-muted-foreground">
          {trace.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}

      {answer !== "" && <p className="whitespace-pre-wrap text-sm text-foreground">{answer}</p>}

      {error && <ErrorState message={error} />}
    </section>
  );
}
