import { guard } from "@/lib/guard";
import { analyzeConversation } from "@/lib/ai";
import { observe, failure } from "@/lib/observe";
import { transcripts } from "@/lib/transcripts";

export async function POST(request: Request) {
  return observe("analyze", (requestId) => handle(request, requestId));
}

// Experiment 015: takes a conversation id, not a conversation. Same reasoning
// as /api/chat — this route used to accept whatever history the client sent,
// which meant it analysed a conversation that need not have happened.
async function handle(request: Request, requestId: string) {
  const auth = guard(request, "analyze");
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { conversation_id: conversationId } = (body ?? {}) as { conversation_id?: unknown };

  if (typeof conversationId !== "string" || conversationId.trim() === "") {
    return Response.json({ error: "conversation_id must be a string" }, { status: 400 });
  }

  // Same authorized lookup as /api/chat — analysing someone else's conversation
  // would be reading it, just with an extra step.
  if (transcripts.readable(conversationId, auth.userId) === null) {
    return Response.json({ error: "Unknown conversation" }, { status: 404 });
  }

  const messages = transcripts.read(conversationId);

  if (messages.length === 0) {
    return Response.json({ error: "Conversation has no turns yet" }, { status: 400 });
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
        { error: "Model output did not match the schema", request_id: requestId },
        { status: 502 },
      );
    }

    return Response.json({
      analysis: response.parsed_output,
      usage: response.usage,
      stop_reason: response.stop_reason,
    });
  } catch (error) {
    return failure(requestId, "analyze", "Analysis failed", 502, error);
  }
}
