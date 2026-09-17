// Experiment 036. guard.ts is the application's entire auth/authz/budget
// boundary — every route calls guard(request, route, requestId) before doing
// any work — and it had no unit test. Not neglect: checkAuth()/checkBudget()/
// budgetStatus()/currentUserId() call the SINGLETON db-backed wrappers
// (users.ensureDev(), usage.spentTotal(), revocations.isRevoked()) directly,
// rather than taking an injectable DatabaseSync the way users.ts/usage.ts/
// revocation.ts's OWN functions do — so testing them meant either touching
// the real `.data/forge.db` or refactoring guard.ts's signature. Neither was
// necessary: db.ts's singleton reads FORGE_DB_PATH once, at import time, and
// tests/run.mts now sets it to ":memory:" before any test file loads — so
// every singleton call in THIS file gets an isolated, throwaway database.
import { randomUUID } from "node:crypto";

import { authRequired, budgetStatus, COST, currentUserId, guard, hasValidSession }
  from "@/lib/guard";
import { createUser, DEV_USER_ID } from "@/lib/users";
import { db } from "@/lib/db";
import { recordUsage } from "@/lib/usage";
import { revocations } from "@/lib/revocation";
import { reservations } from "@/lib/reservation";
import { issueSession } from "@/lib/session";
import { dollars, formatCost, PRICING, DEFAULT_MODEL, MAX_OUTPUT_TOKENS } from "@/lib/pricing";
import { group, ok, eq } from "./harness.mts";

const SECRET = "test-app-secret-value-long-enough";

/** Every call below restores whatever env vars it touches — this is global
 * process state, shared with every test file that runs after this one in the
 * same process. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const before: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) before[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://test.local/", { headers });
}

function cookieHeader(userId: string, secret = SECRET, now = Date.now()): string {
  return `forge_session=${issueSession(secret, userId, now)}`;
}

/** `usage` has a FOREIGN KEY on user_id — unlike the session-cookie path
 * itself (which trusts a valid signature with no DB lookup at all), spending
 * money against an id requires that id to actually exist. */
function realUser(): string {
  return createUser(db(), `guard-test-${randomUUID().slice(0, 8)}`, "a-long-enough-password", Date.now()).id;
}

group("guard — authRequired() reflects whether APP_SECRET is configured");
withEnv({ APP_SECRET: undefined }, () => {
  ok("unset secret means auth is not required", !authRequired());
});
withEnv({ APP_SECRET: "" }, () => {
  ok("an empty secret is the same as unset", !authRequired());
});
withEnv({ APP_SECRET: SECRET }, () => {
  ok("a real secret means auth IS required", authRequired());
});

group("guard — dev-open mode (no APP_SECRET, not production)");
withEnv({ APP_SECRET: undefined, NODE_ENV: "test" }, () => {
  const result = guard(req(), "chat", randomUUID());
  ok("guard succeeds without any credential", !(result instanceof Response));
  if (!(result instanceof Response)) {
    eq("as the fixed dev user", result.userId, DEV_USER_ID);
  }
  eq("currentUserId agrees", currentUserId(req()), DEV_USER_ID);
  ok("hasValidSession is true — dev mode is open by definition", hasValidSession(req()));
});

group("guard — production with no APP_SECRET fails CLOSED, not open");
withEnv({ APP_SECRET: undefined, NODE_ENV: "production" }, () => {
  const result = guard(req(), "chat", randomUUID());
  ok("guard refuses", result instanceof Response);
  if (result instanceof Response) {
    eq("503 — misconfiguration, not permission", result.status, 503);
  }
});

group("guard — with a real secret configured, no credential at all is 401");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test" }, () => {
  const result = guard(req(), "chat", randomUUID());
  ok("refused", result instanceof Response);
  if (result instanceof Response) eq("401", result.status, 401);
});

group("guard — Bearer token: correct secret authenticates as the operator");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test" }, () => {
  const result = guard(req({ authorization: `Bearer ${SECRET}` }), "chat", randomUUID());
  ok("succeeds", !(result instanceof Response));
  if (!(result instanceof Response)) {
    eq("as the dev/operator user — the token names no one else", result.userId, DEV_USER_ID);
  }
});

group("guard — Bearer token: wrong secret, same length, is 401");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test" }, () => {
  const wrong = "x".repeat(SECRET.length);
  const result = guard(req({ authorization: `Bearer ${wrong}` }), "chat", randomUUID());
  ok("refused", result instanceof Response);
  if (result instanceof Response) eq("401, not distinguished from any other failure", result.status, 401);
});

group("guard — Bearer token: wrong LENGTH does not throw, still 401");
// secretMatches() has a dedicated branch for this — timingSafeEqual() throws
// on a length mismatch, which would itself leak the real secret's length via
// a crash instead of a clean 401.
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test" }, () => {
  const result = guard(req({ authorization: "Bearer short" }), "chat", randomUUID());
  ok("refused, not thrown", result instanceof Response);
  if (result instanceof Response) eq("401", result.status, 401);
});

group("guard — session cookie: valid, unexpired, unrevoked");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test" }, () => {
  // A real user, not an arbitrary uuid — Experiment 037's reservation carries
  // a genuine FOREIGN KEY on user_id, unlike the read-only checks this route
  // used to make. A signature only proves the claim is unforged; it was
  // never proof the subject exists, which is exactly why the session-cookie
  // path trusts the MAC and nothing else (see checkAuth's comment).
  const userId = realUser();
  const result = guard(req({ cookie: cookieHeader(userId) }), "chat", randomUUID());
  ok("succeeds", !(result instanceof Response));
  if (!(result instanceof Response)) {
    eq("as the SIGNED subject, not the dev user", result.userId, userId);
  }
  eq("currentUserId agrees", currentUserId(req({ cookie: cookieHeader(userId) })), userId);
});

group("guard — session cookie: wrong secret's signature does not verify");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test" }, () => {
  const userId = randomUUID();
  const badCookie = cookieHeader(userId, "a-completely-different-secret-value");
  const result = guard(req({ cookie: badCookie }), "chat", randomUUID());
  ok("refused", result instanceof Response);
  if (result instanceof Response) eq("401", result.status, 401);
  eq("hasValidSession agrees", hasValidSession(req({ cookie: badCookie })), false);
  eq("currentUserId agrees — null, not a guess", currentUserId(req({ cookie: badCookie })), null);
});

group("guard — session cookie: revoked despite a valid signature");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test" }, () => {
  // Real, same reason as the group above: the first guard() call below
  // succeeds and reaches checkBudget(), which now inserts a reservation row.
  const userId = realUser();
  const token = issueSession(SECRET, userId, Date.now());
  const cookie = `forge_session=${token}`;

  ok("valid before revocation", !(guard(req({ cookie }), "chat", randomUUID()) instanceof Response));
  revocations.revoke(token, Date.now() + 60_000);
  const result = guard(req({ cookie }), "chat", randomUUID());
  ok("refused after revocation — same signature, different fact about the world",
    result instanceof Response);
  if (result instanceof Response) eq("401", result.status, 401);
  eq("hasValidSession agrees", hasValidSession(req({ cookie })), false);
});

group("guard — missing cookie/header: hasValidSession and currentUserId agree with guard");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test" }, () => {
  ok("hasValidSession is false", !hasValidSession(req()));
  eq("currentUserId is null", currentUserId(req()), null);
});

group("guard — a free route (COST 0) bypasses the budget check entirely");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test", FORGE_DAILY_BUDGET_USD: "0" }, () => {
  // Total budget set to $0 — already exhausted by definition — yet a free
  // route must still succeed, because it never asks the question.
  eq("search costs nothing", COST.search, 0);
  const userId = randomUUID();
  const result = guard(req({ cookie: cookieHeader(userId) }), "search", randomUUID());
  ok("free route succeeds even with a zero budget", !(result instanceof Response));
});

group("guard — checkBudget: per-user budget exceeded");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test", FORGE_USER_DAILY_BUDGET_USD: "0.01" }, () => {
  const userId = realUser();
  // 1000 in x $5/MTok + 500 out x $25/MTok = $0.0175 — over the $0.01 cap set above.
  recordUsage(db(), {
    requestId: randomUUID(), userId, conversationId: null, route: "chat",
    model: "claude-opus-5", usage: { input_tokens: 1000, output_tokens: 500 },
  }, Date.now());

  const result = guard(req({ cookie: cookieHeader(userId) }), "chat", randomUUID());
  ok("refused", result instanceof Response);
  if (result instanceof Response) {
    eq("429, not 401 or 500 — this is a budget fact, not an auth failure", result.status, 429);
    ok("Retry-After is present", result.headers.get("retry-after") !== null);
  }
});

group("guard — checkBudget: under the per-user budget succeeds");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test", FORGE_USER_DAILY_BUDGET_USD: "5" }, () => {
  const userId = realUser();
  recordUsage(db(), {
    requestId: randomUUID(), userId, conversationId: null, route: "chat",
    model: "claude-opus-5", usage: { input_tokens: 1000, output_tokens: 500 },
  }, Date.now());

  const result = guard(req({ cookie: cookieHeader(userId) }), "chat", randomUUID());
  ok("succeeds — $0.0175 spent, $5 allowed", !(result instanceof Response));
});

group("guard — checkBudget: total daily budget exceeded, even under the per-user cap");
withEnv({
  APP_SECRET: SECRET, NODE_ENV: "test",
  FORGE_DAILY_BUDGET_USD: "0.01", FORGE_USER_DAILY_BUDGET_USD: "5",
}, () => {
  const spender = realUser();
  recordUsage(db(), {
    requestId: randomUUID(), userId: spender, conversationId: null, route: "chat",
    model: "claude-opus-5", usage: { input_tokens: 1000, output_tokens: 500 },
  }, Date.now());

  // A DIFFERENT user, who has personally spent nothing, still gets refused —
  // the total ceiling protects the OPERATOR's bill, not just each caller's own.
  const newUser = realUser();
  const result = guard(req({ cookie: cookieHeader(newUser) }), "chat", randomUUID());
  ok("refused despite this user having spent $0", result instanceof Response);
  if (result instanceof Response) {
    eq("429", result.status, 429);
  }
});

// Experiment 037. The gap checkBudget()'s own comment named since 017: two
// requests arriving together both read the same spent-so-far figure — $0,
// since neither has billed anything yet — and both used to proceed. What
// guard() reserves before returning is what closes that window.
const RESERVED_FOR_CHAT = COST.chat * MAX_OUTPUT_TOKENS * PRICING[DEFAULT_MODEL].output;

// Scoped to the PER-USER budget, not the total: every group above this one
// already ran guard() successfully several times over, and those reservations
// are still outstanding (their 5-minute TTL far outlives this whole test
// file). The total budget check would see all of that accumulated state; the
// per-user one, keyed to a fresh realUser() nobody else has touched, is
// isolated from it the same way the existing per-user tests above already are.
group("guard — reservation: a second concurrent request is refused before either bills a cent");
withEnv({
  APP_SECRET: SECRET, NODE_ENV: "test",
  // Room for one chat reservation and a bit more, not two.
  FORGE_USER_DAILY_BUDGET_USD: String((RESERVED_FOR_CHAT * 1.5) / 1e9),
}, () => {
  const userId = realUser();
  const first = guard(req({ cookie: cookieHeader(userId) }), "chat", randomUUID());
  ok("the first request succeeds and stakes its claim", !(first instanceof Response));

  const second = guard(req({ cookie: cookieHeader(userId) }), "chat", randomUUID());
  ok("a second request from the SAME user is refused by the first's outstanding " +
    "reservation — not by recorded spend, there is none yet", second instanceof Response);
  if (second instanceof Response) eq("429", second.status, 429);
});

group("guard — reservation: releasing a claim frees the budget it held");
withEnv({
  APP_SECRET: SECRET, NODE_ENV: "test",
  FORGE_USER_DAILY_BUDGET_USD: String((RESERVED_FOR_CHAT * 1.5) / 1e9),
}, () => {
  const userId = realUser();
  const heldRequestId = randomUUID();
  const first = guard(req({ cookie: cookieHeader(userId) }), "chat", heldRequestId);
  ok("succeeds", !(first instanceof Response));

  const blocked = guard(req({ cookie: cookieHeader(userId) }), "chat", randomUUID());
  ok("a second is blocked while the first's claim is outstanding", blocked instanceof Response);

  reservations.release(heldRequestId);

  const afterRelease = guard(req({ cookie: cookieHeader(userId) }), "chat", randomUUID());
  ok("a third succeeds once the held claim is released — same as a route's `finally` would do",
    !(afterRelease instanceof Response));
});

group("guard — reservation: a free route never stakes a claim");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test", FORGE_DAILY_BUDGET_USD: "0" }, () => {
  const before = reservations.activeTotal();
  const result = guard(req({ cookie: cookieHeader(realUser()) }), "search", randomUUID());
  ok("succeeds even with a $0 budget — COST.search is 0", !(result instanceof Response));
  eq("no reservation was staked for it", reservations.activeTotal(), before);
});

group("guard — order of checks: an auth failure wins even when budget is ALSO exhausted");
withEnv({ APP_SECRET: SECRET, NODE_ENV: "test", FORGE_DAILY_BUDGET_USD: "0" }, () => {
  const result = guard(req(), "chat", randomUUID()); // no credential at all
  ok("refused", result instanceof Response);
  if (result instanceof Response) {
    eq("401 — auth is checked before budget, so THIS is why it failed", result.status, 401);
  }
});

group("guard — budgetStatus() reports real, formatted numbers");
withEnv({
  APP_SECRET: SECRET, NODE_ENV: "test",
  FORGE_DAILY_BUDGET_USD: "5", FORGE_USER_DAILY_BUDGET_USD: "1",
}, () => {
  const status = budgetStatus();
  eq("daily budget as configured", status.daily_budget, formatCost(dollars(5)));
  eq("per-user budget as configured", status.per_user_budget, formatCost(dollars(1)));
  ok("spent_today is a cost string", status.spent_today.startsWith("$"));
  ok("remaining is a cost string", status.remaining.startsWith("$"));
});
