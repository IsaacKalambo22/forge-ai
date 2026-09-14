import { askClaude } from "@/lib/ai";
import { MAX_TURNS, isChatMessage } from "@/lib/messages";
import { isPersonaId } from "@/lib/personas";

export async function POST(request: Request) {
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

  try {
    const response = await askClaude(messages, persona ?? "default");
    return Response.json(response);
  } catch (error) {
    // Log the real error server-side; send the client a safe summary.
    console.error("askClaude failed:", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: `Model request failed: ${detail}` }, { status: 502 });
  }
}
