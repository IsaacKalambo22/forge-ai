import { budgetStatus } from "@/lib/guard";
import { currentSnapshot } from "@/lib/telemetry";
import { usage } from "@/lib/usage";
import { indexReady } from "@/lib/knowledge";
import { embedCache, EMBED_CACHE_PATH } from "@/lib/embedcache";
import { EMBEDDING_MODEL } from "@/lib/embeddings";
import { formatCost } from "@/lib/pricing";

import { Badge, EmptyState, PageHeader, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

// Server Component reusing the exact functions behind GET /api/metrics
// (src/app/api/metrics/route.ts) rather than fetching the route itself —
// same authoritative data, no duplicated business logic, no self-request.
export default function MetricsPage() {
  const snapshot = currentSnapshot();
  const budget = budgetStatus();
  const spendByRoute = usage.byRoute();
  const ready = indexReady();
  const cachedVectors = embedCache.count(EMBEDDING_MODEL);

  const routes = Object.entries(snapshot.routes);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Observability"
        description="Live measurements from this server — latency, spend, and retrieval-index health."
      />

      <section className="flex flex-col gap-3">
        <SectionHeading>Budget</SectionHeading>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Spent today</dt>
            <dd className="mt-0.5 font-medium text-foreground">{budget.spent_today}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Remaining</dt>
            <dd className="mt-0.5 font-medium text-foreground">{budget.remaining}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Daily budget</dt>
            <dd className="mt-0.5 font-medium text-foreground">{budget.daily_budget}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Per-user budget</dt>
            <dd className="mt-0.5 font-medium text-foreground">{budget.per_user_budget}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading>Retrieval index</SectionHeading>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone={ready ? "success" : "warning"}>{ready ? "Ready" : "Building"}</Badge>
          <span className="text-muted-foreground">
            {cachedVectors} cached vectors ({EMBEDDING_MODEL})
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Cache: {EMBED_CACHE_PATH}</p>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading>Requests ({snapshot.window} in window, {snapshot.total} total)</SectionHeading>
        {routes.length === 0 ? (
          <EmptyState
            title="No requests recorded yet"
            description="Latency and error rates appear here once traffic reaches this server."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Route</th>
                  <th className="py-2 pr-4 font-medium">Requests</th>
                  <th className="py-2 pr-4 font-medium">Error rate</th>
                  <th className="py-2 pr-4 font-medium">p50</th>
                  <th className="py-2 pr-4 font-medium">p95</th>
                  <th className="py-2 font-medium">Spend (24h)</th>
                </tr>
              </thead>
              <tbody>
                {routes.map(([route, stats]) => {
                  const spend = spendByRoute[route];
                  return (
                    <tr key={route} className="border-b border-border last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs text-foreground">{route}</td>
                      <td className="py-2 pr-4 text-foreground">{stats.count}</td>
                      <td className="py-2 pr-4 text-foreground">
                        {stats.errorRate > 0 ? (
                          <Badge tone="destructive">{(stats.errorRate * 100).toFixed(1)}%</Badge>
                        ) : (
                          <span className="text-muted-foreground">0%</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-foreground">{stats.latency.p50}ms</td>
                      <td className="py-2 pr-4 text-foreground">{stats.latency.p95}ms</td>
                      <td className="py-2 text-foreground">
                        {spend ? formatCost(spend.costNanodollars) : "$0"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
