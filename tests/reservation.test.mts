// Experiment 037. The reservation table guard.ts stakes a claim in before
// authorizing a paid request — see reservation.ts for why.
import { randomUUID } from "node:crypto";

import { openDatabase } from "@/lib/db";
import { createUser } from "@/lib/users";
import {
  reserve, release, activeTotal, activeByUser, purgeExpired, countActive,
} from "@/lib/reservation";
import { group, ok, eq } from "./harness.mts";

const T = 1_700_000_000_000;
const fresh = () => openDatabase(":memory:");

function user(database: ReturnType<typeof fresh>, name: string): string {
  return createUser(database, name, "a-long-enough-password", T).id;
}

group("reservation — the basic contract");
const d = fresh();
const alice = user(d, "alice");
eq("nothing staked yet", activeTotal(d, T), 0);
reserve(d, { requestId: randomUUID(), userId: alice, route: "chat", amountNanodollars: 100 }, T, 60_000);
eq("one claim counted", activeTotal(d, T), 100);
eq("counted against that user too", activeByUser(d, alice, T), 100);

group("reservation — several claims sum, per user and in total");
const bob = user(d, "bob");
reserve(d, { requestId: randomUUID(), userId: alice, route: "chat", amountNanodollars: 50 }, T, 60_000);
reserve(d, { requestId: randomUUID(), userId: bob, route: "agent", amountNanodollars: 200 }, T, 60_000);
eq("total is all three claims", activeTotal(d, T), 100 + 50 + 200);
eq("alice's total is just hers", activeByUser(d, alice, T), 100 + 50);
eq("bob's total is just his", activeByUser(d, bob, T), 200);

group("reservation — releasing a claim removes it, and only it");
const releaseTarget = randomUUID();
const before = activeTotal(d, T);
reserve(d, { requestId: releaseTarget, userId: alice, route: "ask", amountNanodollars: 999 }, T, 60_000);
eq("staked", activeTotal(d, T), before + 999);
release(d, releaseTarget);
eq("released, everything else untouched", activeTotal(d, T), before);

group("reservation — releasing an unknown request id is a no-op, not an error");
const totalBefore = activeTotal(d, T);
release(d, "never-reserved");
eq("nothing changed", activeTotal(d, T), totalBefore);

group("reservation — reserving twice for the same request id does not double-count");
// Idempotent like usage.record()'s UNIQUE(request_id) — a retried request must
// not stake the claim twice.
const dupe = fresh();
const carol = user(dupe, "carol");
const dupeId = randomUUID();
reserve(dupe, { requestId: dupeId, userId: carol, route: "chat", amountNanodollars: 500 }, T, 60_000);
reserve(dupe, { requestId: dupeId, userId: carol, route: "chat", amountNanodollars: 500 }, T, 60_000);
eq("one claim, not two", activeTotal(dupe, T), 500);

group("reservation — expiry: an outstanding claim past its TTL is not counted");
const e = fresh();
const dave = user(e, "dave");
reserve(e, { requestId: randomUUID(), userId: dave, route: "chat", amountNanodollars: 300 }, T, 1000);
eq("counted one ms before expiry", activeTotal(e, T + 999), 300);
eq("not counted exactly at expiry", activeTotal(e, T + 1000), 0);
eq("still not counted well after", activeTotal(e, T + 100_000), 0);
// The row itself is not deleted by merely asking whether it is active — only
// purgeExpired() does that, same split revocation.ts makes.
eq("the row is still physically present until purged", countActive(e), 1);

group("reservation — purging expired rows");
const p = fresh();
const erin = user(p, "erin");
reserve(p, { requestId: "already-expired", userId: erin, route: "chat", amountNanodollars: 1 }, T - 10_000, 1);
reserve(p, { requestId: "still-live", userId: erin, route: "chat", amountNanodollars: 1 }, T, 60_000);
eq("two rows physically present", countActive(p), 2);
eq("purge drops only the expired one", purgeExpired(p, T), 1);
eq("one row left", countActive(p), 1);
eq("purging again removes nothing", purgeExpired(p, T), 0);

group("reservation — survives a restart, same durability guarantee as usage/revocations");
const path = `${process.env.TMPDIR ?? "/tmp"}/forge-reservation-${Math.random().toString(36).slice(2)}.db`;
const beforeRestart = openDatabase(path);
const persistedUser = user(beforeRestart, "frank");
reserve(
  beforeRestart,
  { requestId: randomUUID(), userId: persistedUser, route: "chat", amountNanodollars: 42 },
  T, 60_000,
);
beforeRestart.close();

const afterRestart = openDatabase(path);
eq("the claim is still there after a reopen", activeTotal(afterRestart, T), 42);
afterRestart.close();
