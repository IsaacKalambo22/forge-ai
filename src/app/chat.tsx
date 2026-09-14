"use client";

import { useState } from "react";

import { MAX_TURNS, type ChatMessage } from "@/lib/messages";
import { PERSONA_IDS, type PersonaId } from "@/lib/personas";

export default function Chat() {
  const [input, setInput] = useState("");
  const [persona, setPersona] = useState<PersonaId>("default");
  // This array IS the conversation. The API remembers nothing, so whatever is
  // in here — and only what is in here — is what the model will ever know.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();

    const question = input.trim();
    if (question === "" || loading) return;

    const next: ChatMessage[] = [...messages, { role: "user", content: question }];

    setMessages(next);
    setInput("");
    setLoading(true);
    setError(null);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The WHOLE conversation goes every time, not just the new question.
      // Only the persona *id* crosses the boundary; the prompt text never does.
      body: JSON.stringify({ messages: next, persona }),
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

    // The assistant's reply must be appended too — otherwise the next request
    // sends questions with no answers between them and the model loses the thread.
    setMessages((previous) => [...previous, { role: "assistant", content: answer }]);
    setLoading(false);
  }

  const remaining = MAX_TURNS - messages.length;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-4">
        {messages.map((message, index) => (
          <div key={index} className="flex flex-col gap-1">
            <p className="text-sm font-medium text-zinc-500">
              {message.role === "user" ? "You" : `Claude · ${persona}`}
            </p>
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ))}
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={send} className="flex gap-2">
        <select
          value={persona}
          onChange={(event) => setPersona(event.target.value as PersonaId)}
          className="rounded border border-zinc-300 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {PERSONA_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
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

      <p className="text-sm text-zinc-500">
        {messages.length} messages in context · {remaining} turns before the server
        cap. Every one of them is resent, and re-billed, on every request.
      </p>
    </div>
  );
}
