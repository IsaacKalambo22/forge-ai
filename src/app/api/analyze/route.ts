import { guard } from "@/lib/guard";
import { analyzeConversation } from "@/lib/ai";
import { observe, failure } from "@/lib/observe";
import { transcripts } from "@/lib/transcripts";
import { usage } from "@/lib/usage";
import { formatCost } from "@/lib/pricing";
import { log } from "@/lib/log";

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

    // Experiment 028. This route returned `usage` in the body since it was
    // written but never recorded it — the ledger was blind to every analysis.
    try {
      const cost = usage.record({
        requestId,
        userId: auth.userId,
        conversationId,
        route: "analyze",
        model: response.model,
        usage: response.usage,
      });
      log({ level: "info", msg: "usage", request_id: requestId, route: "analyze",
        model: response.model,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cost: formatCost(cost) });
    } catch (error) {
      // Never let an accounting failure break a reply the user is already
      // reading. Loud in the log, invisible in the response.
      log({ level: "error", msg: "failed to record usage",
        request_id: requestId, route: "analyze",
        error: error instanceof Error ? error.message : String(error) });
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
