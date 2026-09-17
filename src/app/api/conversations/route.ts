import { guard } from "@/lib/guard";
import { transcripts } from "@/lib/transcripts";
import { observe } from "@/lib/observe";

/**
 * Experiment 042. `transcripts.listByOwner()` has existed since Experiment 016 —
 * conversations were owned from the day identity was added. Nothing ever read it
 * back: the chat UI holds exactly one conversation id, in memory, for as long as
 * the tab stays open. Refresh the page and it is gone from the SCREEN, though
 * never from the server — there was no route to ask for it back.
 *
 * Costs nothing (COST.conversations = 0): a read of rows this user already owns,
 * no model call. Still behind `guard` — free is not the same as public.
 */
export async function GET(request: Request) {
  return observe("conversations", async (requestId) => {
    const auth = guard(request, "conversations", requestId);
    if (auth instanceof Response) return auth;

    const conversations = transcripts.listByOwner(auth.userId);

    return Response.json({
      conversations: conversations.map((c) => ({
        id: c.id,
        persona: c.persona,
        created_at: c.created_at,
      })),
    });
  });
}
