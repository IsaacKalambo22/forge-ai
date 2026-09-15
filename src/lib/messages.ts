// Client-safe. `import type` is erased at compile time, so naming an SDK type
// here costs the browser nothing at runtime — unlike a value import, which is
// what leaked the whole SDK in Experiment 002.
import type Anthropic from "@anthropic-ai/sdk";

// Experiment 003 only ever sends text, so we narrow the SDK's MessageParam to
// its string-content branch rather than redefining a parallel type.
export type ChatMessage = Anthropic.MessageParam & { content: string };

// A cost control, not a correctness rule. The Messages API is stateless, so the
// whole conversation is resent on every turn — and until Experiment 015 the
// CLIENT held it, which meant the client decided how many input tokens the
// server paid for. The server now holds the transcript and enforces this in
// `transcripts.appendTurn()`, the one chokepoint every write passes through.
export const MAX_TURNS = 20;

/** A single message. Bounds one request; MAX_TURNS bounds the conversation. */
export const MAX_MESSAGE_LENGTH = 4000;

// `isChatMessage()` lived here until Experiment 015, and its deletion is worth a
// note. It existed to validate client-supplied message arrays — in particular to
// check that a client-sent ASSISTANT turn was well-formed. Since 015 the server
// owns the transcript and no route accepts a message array at all, so the
// validator had nothing left to validate.
//
// That is the shape of the 015 fix in miniature: the defence that survives is the
// one where the dangerous input no longer exists, not the one that inspects it.
// The role/content invariant is now a CHECK constraint in the database instead.

// One of these is sent per line of the NDJSON stream. A discriminated union, so
// the browser can `switch` on `type` and TypeScript checks every branch.
export type StreamEvent =
  // Sent first on /api/chat, before any model output. Experiment 015: the
  // server owns the transcript now, so the client's only handle on a
  // conversation is this id.
  | { type: "conversation"; id: string }
  | { type: "text"; text: string }
  | {
      type: "done";
      usage: Anthropic.Usage;
      stop_reason: string | null;
      model: string;
    }
  | {
      type: "sources";
      sources: { heading: string; file: string; score: number }[];
    }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: string; is_error: boolean }
  | { type: "step"; index: number; calls: string[] }
  | { type: "stopped"; reason: "done" | "budget" | "no_progress"; detail: string }
  | { type: "error"; error: string };
