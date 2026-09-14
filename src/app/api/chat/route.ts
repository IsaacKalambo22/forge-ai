import { askClaude } from "@/lib/ai";
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

  const { message, persona } = (body ?? {}) as {
    message?: unknown;
    persona?: unknown;
  };

  if (typeof message !== "string" || message.trim() === "") {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  // Allowlist, not free text: the client names a persona, the server owns it.
  // An unknown id is rejected rather than silently defaulted, so a typo in the
  // UI is visible instead of quietly changing the model's behaviour.
  if (persona !== undefined && !isPersonaId(persona)) {
    return Response.json({ error: "Unknown persona" }, { status: 400 });
  }

  try {
    const response = await askClaude(message, persona ?? "default");
    return Response.json(response);
  } catch (error) {
    // Log the real error server-side; send the client a safe summary.
    console.error("askClaude failed:", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: `Model request failed: ${detail}` }, { status: 502 });
  }
}
