import "server-only";

import type { DatabaseSync } from "node:sqlite";

import { db } from "./db";
import { costOf, unpricedFields, type TokenUsage } from "./pricing";
import { log } from "./log";

// Experiment 017. The durable answer to "what has this cost, and who spent it".
//
// Three experiments deferred this for the same reason — there was never a real
// `usage` object to record. That is STILL true: no API credential means no
// successful model call means no row written from a live response. What is
// built here is the accounting, and the accounting is verifiable without ever
// calling the model, because arithmetic over recorded fixtures is still
// arithmetic.

export type UsageRecord = {
  requestId: string;
  userId: string | null;
  conversationId: string | null;
  route: string;
  model: string;
  usage: TokenUsage;
};

/**
 * Writes one usage row and returns its cost in nanodollars.
 *
 * Idempotent on `request_id`: a retry of the same request does not double-bill.
 * The UNIQUE constraint makes that a property of the schema rather than of
 * whoever remembers to check first.
 */
export function recordUsage(
  database: DatabaseSync,
  record: UsageRecord,
  now: number,
): number {
  const cost = costOf(record.usage, record.model);

  // If the provider reports a token category this project does not price, the
  // bill will exceed every total recorded here. Loud, and not fatal: refusing
  // to record the request would lose the cost we DO know about.
  const unpriced = unpricedFields(record.usage as unknown as Record<string, unknown>);
  if (unpriced.length > 0) {
    log({
      level: "warn",
      msg: "unpriced usage fields — recorded cost is a LOWER BOUND",
      request_id: record.requestId,
      model: record.model,
      fields: unpriced,
    });
  }

  database
    .prepare(
      `INSERT INTO usage
         (request_id, user_id, conversation_id, route, model,
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
          cost_nanodollars, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(request_id) DO NOTHING`,
    )
    .run(
      record.requestId,
      record.userId,
      record.conversationId,
      record.route,
      record.model,
      record.usage.input_tokens,
      record.usage.output_tokens,
      record.usage.cache_read_input_tokens ?? 0,
      record.usage.cache_creation_input_tokens ?? 0,
      cost,
      now,
    );

  return cost;
}

/** Total nanodollars spent by one user since `since`. */
export function spendByUser(database: DatabaseSync, userId: string, since: number): number {
  const row = database
    .prepare(
      "SELECT COALESCE(SUM(cost_nanodollars), 0) AS total FROM usage " +
        "WHERE user_id = ? AND created_at >= ?",
    )
    .get(userId, since) as { total: number };
  return row.total;
}

/** Total nanodollars spent by everyone since `since`. */
export function totalSpend(database: DatabaseSync, since: number): number {
  const row = database
    .prepare("SELECT COALESCE(SUM(cost_nanodollars), 0) AS total FROM usage WHERE created_at >= ?")
    .get(since) as { total: number };
  return row.total;
}

export type Breakdown = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costNanodollars: number;
};

export function breakdownByRoute(
  database: DatabaseSync,
  since: number,
): Record<string, Breakdown> {
  const rows = database
    .prepare(
      `SELECT route,
              COUNT(*)                        AS requests,
              SUM(input_tokens)               AS inputTokens,
              SUM(output_tokens)              AS outputTokens,
              SUM(cache_read_tokens)          AS cacheReadTokens,
              SUM(cost_nanodollars)           AS costNanodollars
         FROM usage WHERE created_at >= ? GROUP BY route`,
    )
    .all(since) as (Breakdown & { route: string })[];

  const out: Record<string, Breakdown> = {};
  for (const { route, ...rest } of rows) out[route] = rest;
  return out;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------

export const usage = {
  record: (record: UsageRecord) => recordUsage(db(), record, Date.now()),
  spentByUser: (userId: string) => spendByUser(db(), userId, Date.now() - DAY_MS),
  spentTotal: () => totalSpend(db(), Date.now() - DAY_MS),
  byRoute: (sinceMs = DAY_MS) => breakdownByRoute(db(), Date.now() - sinceMs),
};
