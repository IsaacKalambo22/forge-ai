import { guard } from "@/lib/guard";
import { transcripts } from "@/lib/transcripts";
import { observe } from "@/lib/observe";

/**
 * Experiment 042. The read side of switching conversations in the UI: given an
 * id from the list `GET /api/conversations` returned, hand back what the
 * server actually recorded — the persona it was created with, and every turn,
 * oldest first — so the browser can rebuild its state instead of guessing.
 *
 * Same authorized lookup as `/api/chat`/`/api/analyze` (Experiment 016):
 * `readable()` returns null both when the conversation does not exist and when
 * it belongs to someone else, and this route cannot tell the two apart, on
 * purpose — a 403 would confirm the id is real.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  return observe("conversations", async (requestId) => {
    const auth = guard(request, "conversations", requestId);
    if (auth instanceof Response) return auth;

    const { id } = await ctx.params;
    const conversation = transcripts.readable(id, auth.userId);
    if (conversation === null) {
      return Response.json({ error: "Unknown conversation" }, { status: 404 });
    }

    return Response.json({
      id: conversation.id,
      persona: conversation.persona,
      messages: transcripts.read(conversation.id),
    });
  });
}
