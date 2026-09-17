import { headers } from "next/headers";
import Link from "next/link";

import type { Snapshot } from "@/lib/telemetry";
import type { Breakdown } from "@/lib/usage";
import type { budgetStatus } from "@/lib/guard";
import { formatCost } from "@/lib/pricing";
import { SPEND_WINDOWS, type SpendWindow } from "@/lib/metrics-windows";

import { Badge, EmptyState, ErrorState, PageHeader, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

type MetricsResponse = Snapshot & {
  budget: ReturnType<typeof budgetStatus>;
  spend_window: SpendWindow;
  spend: Record<string, Breakdown>;
  index: { ready: boolean; cached_vectors: number; cache_path: string };
};

// Experiment 033. This page used to call currentSnapshot()/indexReady()
// directly (Experiment 030's stated reason: one implementation of "what is
// currently true," no extra hop). MEASURED, that reasoning was wrong for
// exactly these two: they are in-memory module state, and Next.js bundles a
// Server Component page and a Route Handler for the same source file into
// SEPARATE module instances, one per rendering "layer". Confirmed by testing,
// not assumed — hitting /api/search repeatedly grew /api/metrics's reported
// count and flipped the index to ready, while this page, calling the
// functions directly, kept reading an isolated copy stuck at zero/"Building".
//
// `budgetStatus()` / `usage.byRoute()` / `embedCache.count()` never had this
// problem — they read from SQLite, a real file, not a JS module scope, so
// whichever layer opens it sees the same data. The fix here is to read
// EVERYTHING through the one route actually being written to, rather than
// keep two paths where only one is reliably live.
export default async function MetricsPage(props: PageProps<"/metrics">) {
  const params = await props.searchParams;
  const requestedWindow = typeof params.window === "string" ? params.window : undefined;

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const cookie = requestHeaders.get("cookie") ?? "";

  const url =
    `${protocol}://${host}/api/metrics` +
    (requestedWindow ? `?window=${encodeURIComponent(requestedWindow)}` : "");

  const response = await fetch(url, { headers: { cookie }, cache: "no-store" });

  if (!response.ok) {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader
          title="Observability"
          description="Live measurements from this server — latency, spend, and retrieval-index health."
        />
        <ErrorState message={`Could not load metrics (status ${response.status}).`} />
      </div>
    );
  }

  const data = (await response.json()) as MetricsResponse;
  const { budget, spend: spendByRoute, spend_window: spendWindow, index, ...snapshot } = data;
  const routes = Object.entries(snapshot.routes);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Observability"
        description="Live measurements from this server — latency, spend, and retrieval-index health."
      />

      <section className="flex flex-col gap-3">
        <SectionHeading>Budget</SectionHeading>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-muted-foreground">Spent today</dt>
            <dd className="mt-0.5 font-medium text-foreground">{budget.spent_today}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reserved</dt>
            <dd className="mt-0.5 font-medium text-foreground">{budget.reserved}</dd>
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
          <Badge tone={index.ready ? "success" : "warning"}>
            {index.ready ? "Ready" : "Building"}
          </Badge>
          <span className="text-muted-foreground">
            {index.cached_vectors} cached vectors
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Cache: {index.cache_path}</p>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionHeading>Requests</SectionHeading>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Last {snapshot.window} of {snapshot.total} total — latency and error rate
              come from an in-memory buffer of recent requests, not a time range.
            </p>
          </div>
          <nav className="flex items-center gap-1" aria-label="Spend time range">
            {(Object.keys(SPEND_WINDOWS) as SpendWindow[]).map((w) => (
              <Link
                key={w}
                href={w === "24h" ? "/metrics" : `/metrics?window=${w}`}
                aria-current={w === spendWindow ? "page" : undefined}
                className={
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                  (w === spendWindow
                    ? "bg-surface text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {w}
              </Link>
            ))}
          </nav>
        </div>
        {routes.length === 0 ? (
          <EmptyState
            title="No requests recorded yet"
            description="Latency and error rates appear here once traffic reaches this server."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-140 text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Route</th>
                  <th className="py-2 pr-4 font-medium">Requests</th>
                  <th className="py-2 pr-4 font-medium">Error rate</th>
                  <th className="py-2 pr-4 font-medium">p50</th>
                  <th className="py-2 pr-4 font-medium">p95</th>
                  <th className="py-2 font-medium">Spend ({spendWindow})</th>
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
