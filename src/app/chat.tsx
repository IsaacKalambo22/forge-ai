"use client";

import { useReducer, useState } from "react";

import { MAX_TURNS, type StreamEvent } from "@/lib/messages";
import { readNdjsonStream } from "@/lib/ndjson";
import { PERSONA_IDS, type PersonaId } from "@/lib/personas";
import { chatReducer, initialChatState } from "@/lib/chat-state";

import { Button, EmptyState, ErrorState, Input, Select } from "@/components/ui";

export default function Chat() {
  const [input, setInput] = useState("");
  // Effects (fetch, the stream reader) live here. What each event MEANS for
  // the screen lives in chatReducer (src/lib/chat-state.ts) — a pure function,
  // tested in tests/chat-state.test.mts without a browser.
  const [state, dispatch] = useReducer(chatReducer, initialChatState());
  const {
    persona, messages, conversationId, loading, error, streaming, meta, analysis, analysing,
    activity,
  } = state;

  async function send(event: React.FormEvent) {
    event.preventDefault();

    const question = input.trim();
    if (question === "" || loading) return;

    dispatch({ type: "send_started", question });
    setInput("");

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
      dispatch({
        type: "send_rejected",
        error: data.error ?? `Request failed with ${response.status}`,
      });
      return;
    }

    // Experiment 021: one shared NDJSON reader (src/lib/ndjson.ts). This loop
    // used to be hand-rolled here and again in ask.tsx, with the test suite
    // mirroring a third copy — so the test verified none of the shipped code.
    let answer = "";

    await readNdjsonStream<StreamEvent>(response.body, (event) => {
      if (event.type === "text") answer += event.text;
      dispatch({ type: "stream_event", event });
    });

    dispatch({ type: "send_finished", answer });
  }

  function changePersona(next: PersonaId) {
    dispatch({ type: "persona_changed", persona: next });
  }

  async function analyse() {
    if (conversationId === null || messages.length === 0 || analysing) return;

    dispatch({ type: "analyse_started" });

    // Not a stream, so a real status code is available here.
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId }),
    });

    const data = await response.json();

    if (!response.ok) {
      dispatch({
        type: "analyse_failed",
        error: data.error ?? `Request failed with ${response.status}`,
      });
    } else {
      dispatch({ type: "analyse_succeeded", analysis: data.analysis });
    }
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
