"use client";

import { useState } from "react";

type Exchange = {
  question: string;
  answer: string;
};

export default function Chat() {
  const [input, setInput] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();

    const question = input.trim();
    if (question === "" || loading) return;

    setLoading(true);
    setError(null);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? `Request failed with ${response.status}`);
      setLoading(false);
      return;
    }

    // `content` is an array of blocks, not a string. Experiment 001 only ever
    // produces text blocks, so we keep the text ones and join them.
    const answer = data.content
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("\n");

    setExchanges((previous) => [...previous, { question, answer }]);
    setInput("");
    setLoading(false);
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-6">
        {exchanges.map((exchange, index) => (
          <div key={index} className="flex flex-col gap-2">
            <p className="text-sm font-medium text-zinc-500">You</p>
            <p className="whitespace-pre-wrap">{exchange.question}</p>
            <p className="text-sm font-medium text-zinc-500">Claude</p>
            <p className="whitespace-pre-wrap">{exchange.answer}</p>
          </div>
        ))}
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={send} className="flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask Claude something"
          className="flex-1 rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {loading ? "Thinking…" : "Send"}
        </button>
      </form>
    </div>
  );
}
