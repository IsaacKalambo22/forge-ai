import { analyzeConversation } from "@/lib/ai";
import { MAX_TURNS, isChatMessage } from "@/lib/messages";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages } = (body ?? {}) as { messages?: unknown };

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

  // This route does NOT stream, so unlike /api/chat it can still use real
  // status codes for model failures — see experiments/004-streaming.
  try {
    const response = await analyzeConversation(messages);

    // `parsed_output` is null when the response did not validate against the
    // schema. Constrained decoding makes that unlikely, not impossible — so it
    // is a case to handle, not an assertion to wave through with `!`.
    if (response.parsed_output === null) {
      return Response.json(
        { error: "Model output did not match the schema" },
        { status: 502 },
      );
    }

    return Response.json({
      analysis: response.parsed_output,
      usage: response.usage,
      stop_reason: response.stop_reason,
    });
  } catch (error) {
    console.error("analyzeConversation failed:", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: `Analysis failed: ${detail}` }, { status: 502 });
  }
}
