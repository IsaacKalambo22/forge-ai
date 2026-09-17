// The Chat screen's state machine, as a pure function — the agent.ts /
// expression.ts pattern applied to the browser side for the first time.
//
// `chat.tsx` owns effects (fetch, the NDJSON reader, useReducer's dispatch).
// This module owns the one question effects can't answer on their own:
// given the state and something that just happened, what is the next state?
// No DOM, no fetch, no imports — so it is exhaustively testable without a
// testing library, the same way `tests/agent.test.mts` tests `agent.ts`.

import type { ChatMessage, StreamEvent } from "./messages";
import type { ConversationAnalysis } from "./analysis";
import type { PersonaId } from "./personas";

export type ChatState = {
  persona: PersonaId;
  messages: ChatMessage[];
  conversationId: string | null;
  loading: boolean;
  error: string | null;
  /** The partial reply, rebuilt as deltas arrive. Not in `messages` until the
   * turn completes — an incomplete turn must not become conversation history. */
  streaming: string;
  meta: string | null;
  analysis: ConversationAnalysis | null;
  analysing: boolean;
  activity: string[];
};

export function initialChatState(persona: PersonaId = "default"): ChatState {
  return {
    persona,
    messages: [],
    conversationId: null,
    loading: false,
    error: null,
    streaming: "",
    meta: null,
    analysis: null,
    analysing: false,
    activity: [],
  };
}

export type ChatAction =
  // The request left the browser: append the user's turn, clear the
  // previous turn's leftovers (streaming/meta/activity/error).
  | { type: "send_started"; question: string }
  // The request was rejected before streaming began (validation, a 4xx/5xx).
  | { type: "send_rejected"; error: string }
  // One event off the NDJSON stream.
  | { type: "stream_event"; event: StreamEvent }
  // The stream ended. `answer` is what was actually accumulated — empty
  // means the turn produced nothing and must not join history.
  | { type: "send_finished"; answer: string }
  // The persona is fixed when the server creates a conversation, so changing
  // it starts a new one rather than silently retargeting an existing
  // transcript whose earlier turns were produced under different instructions.
  | { type: "persona_changed"; persona: PersonaId }
  | { type: "analyse_started" }
  | { type: "analyse_succeeded"; analysis: ConversationAnalysis }
  | { type: "analyse_failed"; error: string };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send_started":
      return {
        ...state,
        messages: [...state.messages, { role: "user", content: action.question }],
        loading: true,
        error: null,
        streaming: "",
        meta: null,
        activity: [],
      };

    case "send_rejected":
      return { ...state, loading: false, error: action.error };

    case "stream_event":
      return applyStreamEvent(state, action.event);

    case "send_finished":
      return {
        ...state,
        // Only a completed reply joins the history.
        messages:
          action.answer === ""
            ? state.messages
            : [...state.messages, { role: "assistant", content: action.answer }],
        streaming: "",
        loading: false,
      };

    case "persona_changed":
      return {
        ...initialChatState(action.persona),
      };

    case "analyse_started":
      return { ...state, analysing: true, error: null };

    case "analyse_succeeded":
      return { ...state, analysing: false, analysis: action.analysis };

    case "analyse_failed":
      return { ...state, analysing: false, error: action.error };

    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled chat action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function applyStreamEvent(state: ChatState, event: StreamEvent): ChatState {
  switch (event.type) {
    case "conversation":
      // Arrives before any model output, so a turn that fails halfway still
      // leaves the browser able to resume the right conversation.
      return { ...state, conversationId: event.id };

    case "text":
      return { ...state, streaming: state.streaming + event.text };

    case "done":
      return {
        ...state,
        meta:
          `${event.usage.input_tokens} in / ${event.usage.output_tokens} out · ` +
          `stop_reason: ${event.stop_reason} · ${event.model}`,
      };

    case "tool_use":
      return {
        ...state,
        activity: [...state.activity, `→ ${event.name}(${JSON.stringify(event.input)})`],
      };

    case "tool_result":
      return {
        ...state,
        activity: [
          ...state.activity,
          `${event.is_error ? "✗" : "←"} ${event.name}: ${event.output}`,
        ],
      };

    case "error":
      // Reported on an HTTP 200: the status was already sent.
      return { ...state, error: event.error };

    // "sources" / "step" / "stopped" belong to /api/ask and /api/agent, not
    // /api/chat's stream — chat.tsx never receives them, but StreamEvent is
    // one shared union, so the switch must still be exhaustive.
    case "sources":
    case "step":
    case "stopped":
      return state;

    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled stream event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
