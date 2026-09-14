// Client-safe. `import type` is erased at compile time, so naming an SDK type
// here costs the browser nothing at runtime — unlike a value import, which is
// what leaked the whole SDK in Experiment 002.
import type Anthropic from "@anthropic-ai/sdk";

// Experiment 003 only ever sends text, so we narrow the SDK's MessageParam to
// its string-content branch rather than redefining a parallel type.
export type ChatMessage = Anthropic.MessageParam & { content: string };

// A cost control, not a correctness rule. The API is stateless, so the client
// resends the whole conversation every turn — meaning the CLIENT decides how
// many input tokens the server pays for. Capping it server-side is the only
// place that decision can be trusted.
export const MAX_TURNS = 20;

export function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const { role, content } = value as { role?: unknown; content?: unknown };
  return (
    (role === "user" || role === "assistant") &&
    typeof content === "string" &&
    content.trim() !== ""
  );
}

// One of these is sent per line of the NDJSON stream. A discriminated union, so
// the browser can `switch` on `type` and TypeScript checks every branch.
export type StreamEvent =
  | { type: "text"; text: string }
  | {
      type: "done";
      usage: Anthropic.Usage;
      stop_reason: string | null;
      model: string;
    }
  | { type: "error"; error: string };
