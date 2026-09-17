import { guard, budgetStatus } from "@/lib/guard";
import { currentSnapshot } from "@/lib/telemetry";
import { usage } from "@/lib/usage";
import { indexReady } from "@/lib/knowledge";
import { embedCache, EMBED_CACHE_PATH } from "@/lib/embedcache";
import { EMBEDDING_MODEL } from "@/lib/embeddings";
import { observe } from "@/lib/observe";
import { parseSpendWindow, SPEND_WINDOWS } from "@/lib/metrics-windows";

/**
 * The read side of Experiment 014. Structured logs answer "what happened to
 * THIS request"; this answers "what is happening in aggregate".
 *
 * Behind `guard` on purpose. Latency distributions and per-status counts are
 * a description of how the service behaves under load — useful to an operator
 * and useful to someone probing it. It costs nothing, so its COST is 0, but
 * free is not the same as public.
 *
 * GET, because it reads. That also means it is reachable from a browser
 * address bar, which is most of its value at this stage.
 */
export async function GET(request: Request) {
  return observe("metrics", async (requestId) => {
    const auth = guard(request, "metrics", requestId);
    if (auth instanceof Response) return auth;

    // Experiment 033: a caller-chosen window, whitelisted (metrics-windows.ts)
    // so an arbitrary value can't turn into an arbitrary-width SQL scan.
    const spendWindow = parseSpendWindow(new URL(request.url).searchParams.get("window"));

    // Experiment 017: latency and status alone do not say what the service
    // COST to run. Spending is the other half of knowing how it is behaving.
    return Response.json({
      ...currentSnapshot(),
      budget: budgetStatus(),
      spend_window: spendWindow,
      spend: usage.byRoute(SPEND_WINDOWS[spendWindow]),
      // Experiment 025. 014 reported how fast and how often, 017 how much.
      // Whether the thing can answer at all belongs beside them — it is the
      // difference between "slow" and "still starting", which a latency number
      // alone cannot express.
      index: {
        ready: indexReady(),
        cached_vectors: embedCache.count(EMBEDDING_MODEL),
        cache_path: EMBED_CACHE_PATH,
      },
    }, {
      // Never cache a measurement; a cached one is a lie with a timestamp.
      headers: { "Cache-Control": "no-store" },
    });
  });
}
