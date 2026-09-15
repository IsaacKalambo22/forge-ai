"use client";

import { useState } from "react";

import { MAX_TURNS, type ChatMessage, type StreamEvent } from "@/lib/messages";
import type { ConversationAnalysis } from "@/lib/analysis";
import { PERSONA_IDS, type PersonaId } from "@/lib/personas";

export default function Chat() {
  const [input, setInput] = useState("");
  const [persona, setPersona] = useState<PersonaId>("default");
  // Experiment 015. This array is now only what the screen SHOWS. The server
  // holds the real transcript; this is a local echo of it, and the id below is
  // the only handle the browser has on the real thing.
  //
  // Before 015 this array WAS the conversation — it was sent in full on every
  // request, which meant the browser could claim the model had said anything.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The partial reply, rebuilt as deltas arrive. It is NOT in `messages` yet —
  // an incomplete turn must not become part of the conversation history.
  const [streaming, setStreaming] = useState("");
  const [meta, setMeta] = useState<string | null>(null);
  // A typed object, not a string. This is the whole point of structured output:
  // `analysis.title` is a field the UI can use, not prose to be parsed.
  const [analysis, setAnalysis] = useState<ConversationAnalysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  // Tool activity for the turn in progress. Showing it is the point: the loop
  // is invisible otherwise, and an agent you cannot watch is one you cannot debug.
  const [activity, setActivity] = useState<string[]>([]);

  async function send(event: React.FormEvent) {
    event.preventDefault();

    const question = input.trim();
    if (question === "" || loading) return;

    const next: ChatMessage[] = [...messages, { role: "user", content: question }];

    setMessages(next);
    setInput("");
    setLoading(true);
    setError(null);

    setStreaming("");
    setMeta(null);
    setActivity([]);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Experiment 015: an id and ONE message. The history no longer crosses
      // the boundary at all, in either direction. `persona` is only read when
      // the server creates a new conversation.
      body: JSON.stringify({
        conversation_id: conversationId ?? undefined,
        message: question,
        persona,
      }),
    });

    // A non-200 here means the request was rejected BEFORE streaming began —
    // validation. Those responses are still ordinary JSON.
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? `Request failed with ${response.status}`);
      setLoading(false);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      // Network chunks do NOT align with line boundaries: one read can deliver
      // half a JSON object, or three and a half. Keep the remainder in `buffer`
      // and only parse up to the last complete newline.
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") continue;
        const event = JSON.parse(line) as StreamEvent;

        if (event.type === "conversation") {
          // Arrives before any model output, so a turn that fails halfway still
          // leaves the browser able to resume the right conversation.
          setConversationId(event.id);
        } else if (event.type === "text") {
          answer += event.text;
          setStreaming(answer);
        } else if (event.type === "done") {
          setMeta(
            `${event.usage.input_tokens} in / ${event.usage.output_tokens} out · ` +
              `stop_reason: ${event.stop_reason} · ${event.model}`,
          );
        } else if (event.type === "tool_use") {
          setActivity((previous) => [
            ...previous,
            `→ ${event.name}(${JSON.stringify(event.input)})`,
          ]);
        } else if (event.type === "tool_result") {
          setActivity((previous) => [
            ...previous,
            `${event.is_error ? "✗" : "←"} ${event.name}: ${event.output}`,
          ]);
        } else if (event.type === "error") {
          // Reported on an HTTP 200: the status was already sent.
          setError(event.error);
        }
      }
    }

    // Only a completed reply joins the history.
    if (answer !== "") {
      setMessages((previous) => [...previous, { role: "assistant", content: answer }]);
    }
    setStreaming("");
    setLoading(false);
  }

  // The persona is fixed when the server creates a conversation, so changing it
  // starts a new one rather than silently applying to a transcript whose
  // earlier turns were produced under different instructions.
  function changePersona(next: PersonaId) {
    setPersona(next);
    setConversationId(null);
    setMessages([]);
    setAnalysis(null);
    setMeta(null);
    setActivity([]);
    setError(null);
  }

  async function analyse() {
    if (conversationId === null || messages.length === 0 || analysing) return;

    setAnalysing(true);
    setError(null);

    // Not a stream, so a real status code is available here.
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? `Request failed with ${response.status}`);
    } else {
      setAnalysis(data.analysis);
    }

    setAnalysing(false);
  }

  const remaining = MAX_TURNS - messages.length;

  return (
    <div className="flex w-full flex-col gap-6">
      {analysis && (
        <div className="rounded border border-zinc-300 p-4 dark:border-zinc-700">
          <h2 className="font-semibold">{analysis.title}</h2>
          {analysis.topics.length > 0 && (
            <p className="mt-2 text-sm text-zinc-500">
              Topics: {analysis.topics.join(" · ")}
            </p>
          )}
          {analysis.open_questions.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-zinc-500">
              {analysis.open_questions.map((question, index) => (
                <li key={index}>{question}</li>
              ))}
            </ul>
          )}
        </div>
      )}

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

      {activity.length > 0 && (
        <ul className="rounded border border-zinc-300 p-3 font-mono text-xs text-zinc-500 dark:border-zinc-700">
          {activity.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}

      {streaming !== "" && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-zinc-500">Claude · {persona}</p>
          <p className="whitespace-pre-wrap">{streaming}</p>
        </div>
      )}

      {meta && <p className="text-xs text-zinc-500">{meta}</p>}

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={send} className="flex gap-2">
        <select
          value={persona}
          onChange={(event) => changePersona(event.target.value as PersonaId)}
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

      <button
        type="button"
        onClick={analyse}
        disabled={conversationId === null || messages.length === 0 || analysing}
        className="self-start rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-zinc-700"
      >
        {analysing ? "Analysing…" : "Analyse conversation"}
      </button>

      <p className="text-sm text-zinc-500">
        {messages.length} turns · {remaining} before the server cap.
        {conversationId !== null && (
          <>
            {" "}
            Conversation{" "}
            <code className="font-mono text-xs">{conversationId.slice(0, 8)}</code>,
            stored on the server — this page sends only an id and your next message.
          </>
        )}
      </p>
    </div>
  );
}
