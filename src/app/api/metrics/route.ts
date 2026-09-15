import { guard, budgetStatus } from "@/lib/guard";
import { currentSnapshot } from "@/lib/telemetry";
import { usage } from "@/lib/usage";
import { observe } from "@/lib/observe";

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
  return observe("metrics", async () => {
    const auth = guard(request, "metrics");
    if (auth instanceof Response) return auth;

    // Experiment 017: latency and status alone do not say what the service
    // COST to run. Spending is the other half of knowing how it is behaving.
    return Response.json({
      ...currentSnapshot(),
      budget: budgetStatus(),
      spend_24h: usage.byRoute(),
    }, {
      // Never cache a measurement; a cached one is a lie with a timestamp.
      headers: { "Cache-Control": "no-store" },
    });
  });
}
