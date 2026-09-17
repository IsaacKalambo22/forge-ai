// Experiment 030 (continued): chat.tsx's state machine, extracted to a pure
// function so it can be tested exhaustively instead of hand-clicked. Same
// motivation as tests/agent.test.mts — the browser side just never had a
// module shaped this way before.
import { chatReducer, initialChatState, type ChatState } from "@/lib/chat-state";
import type { StreamEvent } from "@/lib/messages";
import { group, ok, eq } from "./harness.mts";

function stream(state: ChatState, event: StreamEvent): ChatState {
  return chatReducer(state, { type: "stream_event", event });
}

group("chat-state — send_started");
{
  const withHistory: ChatState = {
    ...initialChatState(),
    messages: [{ role: "user", content: "earlier" }],
    error: "stale error",
    meta: "stale meta",
    activity: ["stale activity"],
    streaming: "stale partial",
  };
  const next = chatReducer(withHistory, { type: "send_started", question: "hello" });

  eq("appends the user turn without dropping history", next.messages, [
    { role: "user", content: "earlier" },
    { role: "user", content: "hello" },
  ]);
  ok("sets loading", next.loading === true);
  ok("clears the previous turn's error", next.error === null);
  ok("clears the previous turn's meta", next.meta === null);
  eq("clears the previous turn's activity", next.activity, []);
  eq("clears the previous turn's streaming buffer", next.streaming, "");
}

group("chat-state — send_rejected");
{
  const loading: ChatState = { ...initialChatState(), loading: true };
  const next = chatReducer(loading, { type: "send_rejected", error: "budget exhausted" });

  ok("clears loading", next.loading === false);
  eq("surfaces the error", next.error, "budget exhausted");
}

group("chat-state — stream_event: conversation");
{
  const next = stream(initialChatState(), { type: "conversation", id: "conv-123" });
  eq("records the conversation id", next.conversationId, "conv-123");
}

group("chat-state — stream_event: text accumulates, does not replace");
{
  let state = initialChatState();
  state = stream(state, { type: "text", text: "Hel" });
  state = stream(state, { type: "text", text: "lo" });
  eq("concatenates deltas in order", state.streaming, "Hello");
}

group("chat-state — stream_event: done formats meta from usage");
{
  const next = stream(initialChatState(), {
    type: "done",
    usage: { input_tokens: 12, output_tokens: 7 } as never,
    stop_reason: "end_turn",
    model: "claude-opus-5",
  });
  eq("meta", next.meta, "12 in / 7 out · stop_reason: end_turn · claude-opus-5");
}

group("chat-state — stream_event: tool_use / tool_result append to activity, in order");
{
  let state = initialChatState();
  state = stream(state, { type: "tool_use", name: "search", input: { q: "x" } });
  state = stream(state, { type: "tool_result", name: "search", output: "3 hits", is_error: false });
  state = stream(state, { type: "tool_result", name: "search", output: "boom", is_error: true });

  eq("activity", state.activity, [
    `→ search({"q":"x"})`,
    "← search: 3 hits",
    "✗ search: boom",
  ]);
}

group("chat-state — stream_event: error, and the events /api/ask and /api/agent send");
{
  const errored = stream(initialChatState(), { type: "error", error: "rate limited" });
  eq("stream error surfaces the same way as send_rejected", errored.error, "rate limited");

  // /api/chat's own NDJSON stream never emits these, but StreamEvent is one
  // union shared with /api/ask and /api/agent — the reducer must not throw
  // if it somehow sees one, and must not mutate state either.
  const before = initialChatState();
  const afterSources = stream(before, { type: "sources", sources: [] });
  const afterStep = stream(before, { type: "step", index: 0, calls: [] });
  const afterStopped = stream(before, { type: "stopped", reason: "done", detail: "" });
  eq("sources event is a no-op for chat", afterSources, before);
  eq("step event is a no-op for chat", afterStep, before);
  eq("stopped event is a no-op for chat", afterStopped, before);
}

group("chat-state — send_finished");
{
  const streaming: ChatState = { ...initialChatState(), streaming: "partial reply", loading: true };

  const completed = chatReducer(streaming, { type: "send_finished", answer: "partial reply" });
  eq("a non-empty answer joins history as the assistant turn", completed.messages, [
    { role: "assistant", content: "partial reply" },
  ]);
  eq("streaming buffer clears", completed.streaming, "");
  ok("loading clears", completed.loading === false);

  const emptied = chatReducer(streaming, { type: "send_finished", answer: "" });
  eq("an empty answer does NOT join history — an incomplete turn is not a turn", emptied.messages, []);
}

group("chat-state — persona_changed resets the conversation, not the persona field");
{
  const midConversation: ChatState = {
    persona: "default",
    messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
    conversationId: "conv-abc",
    loading: false,
    error: "leftover error",
    streaming: "",
    meta: "leftover meta",
    analysis: { title: "t", topics: [], open_questions: [] },
    analysing: false,
    activity: ["leftover activity"],
  };

  const next = chatReducer(midConversation, { type: "persona_changed", persona: "terse" });

  eq("adopts the new persona", next.persona, "terse");
  eq("starts a new conversation id", next.conversationId, null);
  eq("clears the transcript — old turns belong to the old persona's instructions", next.messages, []);
  eq("clears analysis", next.analysis, null);
  eq("clears meta", next.meta, null);
  eq("clears activity", next.activity, []);
  ok("clears error", next.error === null);
}

group("chat-state — analyse lifecycle");
{
  const started = chatReducer(initialChatState(), { type: "analyse_started" });
  ok("sets analysing", started.analysing === true);

  const analysis = { title: "Debugging a stream", topics: ["ndjson"], open_questions: [] };
  const succeeded = chatReducer(started, { type: "analyse_succeeded", analysis });
  ok("clears analysing on success", succeeded.analysing === false);
  eq("stores the analysis", succeeded.analysis, analysis);

  const failed = chatReducer(started, { type: "analyse_failed", error: "conversation not found" });
  ok("clears analysing on failure", failed.analysing === false);
  eq("surfaces the error", failed.error, "conversation not found");
}
