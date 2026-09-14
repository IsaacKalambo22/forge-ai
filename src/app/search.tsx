"use client";

import { useState } from "react";

import type { Lesson } from "@/lib/corpus";

type Result = { item: Lesson; score: number };

export default function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim() === "" || searching) return;

    setSearching(true);
    setError(null);

    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? `Request failed with ${response.status}`);
      setResults(null);
    } else {
      setResults(data.results);
      setMs(data.ms);
    }

    setSearching(false);
  }

  return (
    <section className="flex w-full flex-col gap-3 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <h2 className="text-sm font-medium text-zinc-500">
        Search the notebook by meaning
      </h2>

      <form onSubmit={run} className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. why does a long chat get more expensive"
          className="flex-1 rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded border border-zinc-300 px-4 py-2 disabled:opacity-50 dark:border-zinc-700"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {results && (
        <>
          <ol className="flex flex-col gap-3">
            {results.map(({ item, score }) => (
              <li key={item.id} className="text-sm">
                {/* The score is shown because it is the honest signal: these are
                    relative rankings, not confidence. 0.31 can be a good match. */}
                <span className="font-mono text-xs text-zinc-500">
                  {score.toFixed(3)}
                </span>{" "}
                <span className="text-zinc-500">[{item.experiment}]</span>
                <p className="mt-1">{item.text}</p>
              </li>
            ))}
          </ol>
          {ms !== null && (
            <p className="text-xs text-zinc-500">
              {ms} ms · no API key, no network — the model runs in this server
            </p>
          )}
        </>
      )}
    </section>
  );
}
