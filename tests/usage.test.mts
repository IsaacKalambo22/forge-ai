// Experiment 017.
import { openDatabase } from "@/lib/db";
import { createUser } from "@/lib/users";
import { createConversation } from "@/lib/transcripts";
import { recordUsage, spendByUser, totalSpend, breakdownByRoute } from "@/lib/usage";
import { dollars, formatCost } from "@/lib/pricing";
import { group, ok, eq, throws } from "./harness.mts";

const T = 1_700_000_000_000;
const PASSWORD = "a-long-enough-password";

function world() {
  const db = openDatabase(":memory:");
  const alice = createUser(db, "alice", PASSWORD, T).id;
  const bob = createUser(db, "bob", PASSWORD, T).id;
  return { db, alice, bob };
}

const call = (requestId: string, userId: string | null, route = "chat", input = 1000, output = 500) => ({
  requestId, userId, conversationId: null, route,
  model: "claude-opus-5",
  usage: { input_tokens: input, output_tokens: output },
});

group("usage — recording returns the cost");
const w = world();
// 1000 in x $5/MTok = $0.005; 500 out x $25/MTok = $0.0125. Total $0.0175.
eq("cost is computed, not supplied", recordUsage(w.db, call("r1", w.alice), T), dollars(0.0175));
eq("and stored", spendByUser(w.db, w.alice, 0), dollars(0.0175));
eq("readable as money", formatCost(spendByUser(w.db, w.alice, 0)), "$0.0175");

group("usage — spend is per user");
recordUsage(w.db, call("r2", w.bob, "chat", 2000, 1000), T);
eq("alice unchanged", spendByUser(w.db, w.alice, 0), dollars(0.0175));
eq("bob has his own", spendByUser(w.db, w.bob, 0), dollars(0.035));
eq("the total is both", totalSpend(w.db, 0), dollars(0.0525));
eq("a user who has spent nothing is 0, not null",
  spendByUser(w.db, "11111111-1111-1111-1111-111111111111", 0), 0);

group("usage — a retry does not double-bill");
// request_id is UNIQUE, so idempotency is a property of the schema rather than
// of whoever remembers to check first.
recordUsage(w.db, call("r1", w.alice), T);
recordUsage(w.db, call("r1", w.alice), T);
eq("alice still billed once", spendByUser(w.db, w.alice, 0), dollars(0.0175));

group("usage — the time window");
const t = world();
recordUsage(t.db, call("old", t.alice), T - 100_000);
recordUsage(t.db, call("new", t.alice), T);
eq("everything, from the beginning", spendByUser(t.db, t.alice, 0), dollars(0.035));
eq("only the recent one", spendByUser(t.db, t.alice, T - 1), dollars(0.0175));
eq("nothing in an empty window", spendByUser(t.db, t.alice, T + 1), 0);

group("usage — cache tokens are billed at their own rates");
const c = world();
// 1M cache reads at 0.1x = $0.50; 1M cache writes at 1.25x = $6.25.
recordUsage(c.db, {
  requestId: "cached", userId: c.alice, conversationId: null, route: "chat",
  model: "claude-opus-5",
  usage: { input_tokens: 0, output_tokens: 0,
    cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 },
}, T);
eq("$0.50 + $6.25", spendByUser(c.db, c.alice, 0), dollars(6.75));

group("usage — caching pays for itself on the second request");
// The documented break-even at the 5-minute TTL: write 1.25x + read 0.1x =
// 1.35x, against 2x for sending the same prefix uncached twice.
const cached = dollars(6.25) + dollars(0.5);
const uncached = dollars(5) * 2;
ok("two requests: cached is cheaper", cached < uncached,
  `${formatCost(cached)} vs ${formatCost(uncached)}`);
// But NOT on the first request alone.
ok("one request: caching costs MORE", dollars(6.25) > dollars(5),
  `${formatCost(dollars(6.25))} vs ${formatCost(dollars(5))}`);

group("usage — breakdown by route");
const b = world();
recordUsage(b.db, call("c1", b.alice, "chat"), T);
recordUsage(b.db, call("c2", b.alice, "chat"), T);
recordUsage(b.db, call("a1", b.alice, "analyze", 100, 50), T);
const rows = breakdownByRoute(b.db, 0);
eq("two routes", Object.keys(rows).sort(), ["analyze", "chat"]);
eq("chat request count", rows.chat.requests, 2);
eq("chat tokens are summed", [rows.chat.inputTokens, rows.chat.outputTokens], [2000, 1000]);
eq("chat cost is summed", rows.chat.costNanodollars, dollars(0.035));
eq("analyze is separate", rows.analyze.costNanodollars, dollars(0.00175));

group("usage — the ledger refuses nonsense");
throws("an unpriced model is not recorded as free", () =>
  recordUsage(w.db, { requestId: "x", userId: w.alice, conversationId: null,
    route: "chat", model: "some-other-model", usage: { input_tokens: 1, output_tokens: 1 } }, T));
throws("negative tokens", () =>
  recordUsage(w.db, { requestId: "y", userId: w.alice, conversationId: null,
    route: "chat", model: "claude-opus-5", usage: { input_tokens: -5, output_tokens: 0 } }, T));

group("usage — a conversation is linked, and survives its deletion");
const l = world();
const conv = createConversation(l.db, "default", l.alice, T);
recordUsage(l.db, { requestId: "linked", userId: l.alice, conversationId: conv.id,
  route: "chat", model: "claude-opus-5", usage: { input_tokens: 100, output_tokens: 100 } }, T);
eq("linked", (l.db.prepare("SELECT conversation_id FROM usage WHERE request_id='linked'")
  .get() as { conversation_id: string }).conversation_id, conv.id);
l.db.prepare("DELETE FROM conversations WHERE id = ?").run(conv.id);
// ON DELETE SET NULL, not CASCADE: deleting a conversation must not delete the
// record that it cost money. The spend happened.
eq("the usage row is still there", spendByUser(l.db, l.alice, 0), dollars(0.003));
eq("with a null conversation", (l.db.prepare(
  "SELECT conversation_id FROM usage WHERE request_id='linked'").get() as
  { conversation_id: string | null }).conversation_id, null);

group("usage — survives a restart");
const path = `${process.env.TMPDIR ?? "/tmp"}/forge-usage-${Math.random().toString(36).slice(2)}.db`;
const before = openDatabase(path);
const owner = createUser(before, "alice", PASSWORD, T).id;
recordUsage(before, call("persisted", owner), T);
before.close();
const after = openDatabase(path);
eq("the ledger is still there", spendByUser(after, owner, 0), dollars(0.0175));
after.close();
