"use client";

import { useState } from "react";

import { MAX_TURNS, type ChatMessage, type StreamEvent } from "@/lib/messages";
import { readNdjsonStream } from "@/lib/ndjson";
import type { ConversationAnalysis } from "@/lib/analysis";
import { PERSONA_IDS, type PersonaId } from "@/lib/personas";

import { Button, EmptyState, ErrorState, Input, Select } from "@/components/ui";

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

    // Experiment 021: one shared NDJSON reader (src/lib/ndjson.ts). This loop
    // used to be hand-rolled here and again in ask.tsx, with the test suite
    // mirroring a third copy — so the test verified none of the shipped code.
    let answer = "";

    await readNdjsonStream<StreamEvent>(response.body, (event) => {
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
    });

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
    <section className="flex w-full flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Chat</h2>
        <Select
          aria-label="Persona"
          value={persona}
          onChange={(event) => changePersona(event.target.value as PersonaId)}
        >
          {PERSONA_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </Select>
      </div>

      {analysis && (
        <div className="rounded-md border border-border bg-surface p-4">
          <h3 className="text-sm font-semibold text-foreground">{analysis.title}</h3>
          {analysis.topics.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              Topics: {analysis.topics.join(" · ")}
            </p>
          )}
          {analysis.open_questions.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
              {analysis.open_questions.map((question, index) => (
                <li key={index}>{question}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {messages.length === 0 && streaming === "" ? (
        <EmptyState
          title="No messages yet"
          description="Send a message to start a conversation with Claude."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {messages.map((message, index) => (
            <div key={index} className="flex flex-col gap-1">
              <p className="text-sm font-medium text-muted-foreground">
                {message.role === "user" ? "You" : `Claude · ${persona}`}
              </p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{message.content}</p>
            </div>
          ))}

          {streaming !== "" && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-muted-foreground">Claude · {persona}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{streaming}</p>
            </div>
          )}
        </div>
      )}

      {activity.length > 0 && (
        <ul className="rounded-md border border-border bg-surface p-3 font-mono text-xs text-muted-foreground">
          {activity.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}

      {meta && <p className="text-xs text-muted-foreground">{meta}</p>}

      {error && <ErrorState message={error} />}

      <form onSubmit={send} className="flex gap-2">
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask Claude something"
          className="flex-1"
        />
        <Button type="submit" disabled={loading}>
          {loading ? "Thinking…" : "Send"}
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={analyse}
          disabled={conversationId === null || messages.length === 0 || analysing}
          className="self-start"
        >
          {analysing ? "Analysing…" : "Analyse conversation"}
        </Button>

        <p className="text-sm text-muted-foreground">
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
    </section>
  );
}
