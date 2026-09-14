import { guard } from "@/lib/guard";
import { runToolLoop } from "@/lib/ai";
import { MAX_TURNS, isChatMessage } from "@/lib/messages";
import { isPersonaId } from "@/lib/personas";
import type { StreamEvent } from "@/lib/messages";

export async function POST(request: Request) {
  // Auth, rate limit and budget — before ANY work, and before the first
  // byte, so a real status code is still available (Experiment 004).
  const denied = guard(request, "chat");
  if (denied !== null) return denied;

  // Experiment 001 found that a malformed or `null` body throws *before* the
  // validation below ever runs, producing a 500 with an empty response body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, persona } = (body ?? {}) as {
    messages?: unknown;
    persona?: unknown;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages must be a non-empty array" }, { status: 400 });
  }

  if (messages.length > MAX_TURNS) {
    return Response.json(
      { error: `Conversation too long (max ${MAX_TURNS} turns)` },
      { status: 400 },
    );
  }

  if (!messages.every(isChatMessage)) {
    return Response.json(
      { error: "Each message needs a role of user|assistant and non-empty string content" },
      { status: 400 },
    );
  }

  // The API requires the conversation to start with a user turn, and Opus 5
  // rejects a trailing assistant turn (assistant prefill was removed). Checking
  // here turns a 502 from Anthropic into a 400 we can explain.
  if (messages[0].role !== "user") {
    return Response.json({ error: "Conversation must start with a user message" }, { status: 400 });
  }

  if (messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "Conversation must end with a user message" }, { status: 400 });
  }

  // Allowlist, not free text: the client names a persona, the server owns it.
  // An unknown id is rejected rather than silently defaulted, so a typo in the
  // UI is visible instead of quietly changing the model's behaviour.
  if (persona !== undefined && !isPersonaId(persona)) {
    return Response.json({ error: "Unknown persona" }, { status: 400 });
  }

  // Everything above ran BEFORE any bytes were sent, so it can still choose a
  // status code. Everything below cannot: the status line goes out with the
  // first byte of the stream, so a failure after this point has to be reported
  // *inside* the stream body, on an HTTP 200.
  const encoder = new TextEncoder();

  const responseBody = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        // The loop yields text deltas, tool calls, tool results and a final
        // done event. The route just forwards them — all the mechanics live
        // in runToolLoop().
        for await (const event of runToolLoop(messages, persona ?? "default")) {
          send(event);
        }
      } catch (error) {
        console.error("runToolLoop failed:", error);
        const detail = error instanceof Error ? error.message : "Unknown error";
        send({ type: "error", error: `Model request failed: ${detail}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(responseBody, {
    headers: {
      // Newline-delimited JSON: one complete JSON object per line. Simpler than
      // SSE and enough for this experiment — see the experiment README.
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
