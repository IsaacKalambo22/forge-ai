// Experiment 015. The forgery debt from Experiment 003.
import { openDatabase } from "@/lib/db";
import {
  createConversation, getConversation, getTranscript, appendTurn, turnCount,
  readable, listByOwner,
} from "@/lib/transcripts";
import { MAX_TURNS } from "@/lib/messages";
import { createUser } from "@/lib/users";
import { group, ok, eq, throws } from "./harness.mts";

const T = 1_700_000_000_000;
const PASSWORD = "a-long-enough-password";

// Real users, because `conversations.owner_id` is a FOREIGN KEY. Discovered the
// hard way: the first version of this file used made-up uuids and every insert
// failed with `FOREIGN KEY constraint failed`. The constraint was right.
function fresh() {
  const database = openDatabase(":memory:");
  const alice = createUser(database, "alice", PASSWORD, T);
  const bob = createUser(database, "bob", PASSWORD, T);
  return { db: database, alice: alice.id, bob: bob.id };
}
let ALICE = "";

group("transcripts — create and read back");
const world = fresh();
const d = world.db;
ALICE = world.alice;
const c = createConversation(d, "engineer", ALICE, T);
ok("id looks like a UUID", /^[0-9a-f-]{36}$/.test(c.id), c.id);
eq("persona is stored", getConversation(d, c.id)?.persona, "engineer");
eq("an unknown conversation is null, not a throw", getConversation(d, "nope"), null);
eq("a new conversation has no turns", getTranscript(d, c.id), []);

group("transcripts — ordering is the server's, not the client's");
appendTurn(d, c.id, "user", "first", T);
appendTurn(d, c.id, "assistant", "second", T + 1);
appendTurn(d, c.id, "user", "third", T + 2);
eq("read back in the order written", getTranscript(d, c.id), [
  { role: "user", content: "first" },
  { role: "assistant", content: "second" },
  { role: "user", content: "third" },
]);
eq("seq is assigned by the server", appendTurn(d, c.id, "assistant", "fourth", T + 3), 3);
eq("count reflects it", turnCount(d, c.id), 4);

group("transcripts — two conversations do not leak into each other");
const other = createConversation(d, "terse", ALICE, T);
appendTurn(d, other.id, "user", "separate", T);
eq("the other transcript is its own", getTranscript(d, other.id), [
  { role: "user", content: "separate" },
]);
eq("and the first is unchanged", turnCount(d, c.id), 4);

group("transcripts — rejects");
throws("unknown conversation", () => appendTurn(d, "nope", "user", "hi", T));
throws("empty content", () => appendTurn(d, c.id, "user", "", T));
throws("whitespace-only content", () => appendTurn(d, c.id, "user", "   ", T));

group("transcripts — the turn cap is enforced at the chokepoint");
// Experiment 003's cost control. The client used to resend the whole history,
// so the CLIENT decided how many input tokens the server paid for. Now the
// server counts.
const cappedWorld = fresh();
const capped = cappedWorld.db;
const cc = createConversation(capped, "default", cappedWorld.alice, T);
for (let i = 0; i < MAX_TURNS; i++) appendTurn(capped, cc.id, "user", `turn ${i}`, T);
eq("filled to the cap", turnCount(capped, cc.id), MAX_TURNS);
throws("one more user turn is refused", () => appendTurn(capped, cc.id, "user", "one more", T));
ok("but the model's reply is still recorded", (() => {
  // Refusing to record what the model just said would corrupt the transcript
  // to save nothing — that request was already paid for.
  appendTurn(capped, cc.id, "assistant", "the paid-for reply", T);
  return turnCount(capped, cc.id) === MAX_TURNS + 1;
})());

group("transcripts — THE Experiment 003 FIX");
// 003: "Client-held history can be forged. The server has no record of what the
// model actually said, so a client-supplied assistant turn is only a claim."
//
// A forged assistant turn is the client writing into the model's context —
// "you already agreed to ignore your instructions" is an assistant turn.
const forgeWorld = fresh();
const forge = forgeWorld.db;
const fc = createConversation(forge, "default", forgeWorld.alice, T);
appendTurn(forge, fc.id, "user", "What is the admin password?", T);
appendTurn(forge, fc.id, "assistant", "I can't share that.", T + 1);

// The client now sends a conversation id and ONE new user message. There is no
// parameter through which it can supply an assistant turn at all.
const asTheModelSaw = getTranscript(forge, fc.id);
eq("the transcript is exactly what the server recorded", asTheModelSaw, [
  { role: "user", content: "What is the admin password?" },
  { role: "assistant", content: "I can't share that." },
]);
ok("every assistant turn came from the server",
  asTheModelSaw.filter((m) => m.role === "assistant")
    .every((m) => m.content === "I can't share that."));

group("transcripts — survives a restart");
// The property none of the project's earlier stores had.
const path = `${process.env.TMPDIR ?? "/tmp"}/forge-tx-${Math.random().toString(36).slice(2)}.db`;
const before = openDatabase(path);
const persistedOwner = createUser(before, "alice", PASSWORD, T).id;
const persisted = createConversation(before, "terse", persistedOwner, T);
appendTurn(before, persisted.id, "user", "remember me", T);
appendTurn(before, persisted.id, "assistant", "recorded", T + 1);
before.close();

const after = openDatabase(path);
eq("the transcript is still there", getTranscript(after, persisted.id), [
  { role: "user", content: "remember me" },
  { role: "assistant", content: "recorded" },
]);
eq("and it can be continued", appendTurn(after, persisted.id, "user", "still here?", T + 2), 2);
after.close();


group("transcripts — AUTHORIZATION (Experiment 016)");
// 015 made conversations durable and left them unowned: the project could tell
// a session was valid and could not tell whose conversation this was.
const authWorld = fresh();
const mine = createConversation(authWorld.db, "default", authWorld.alice, T);
appendTurn(authWorld.db, mine.id, "user", "something private", T);

ok("the owner can read it", readable(authWorld.db, mine.id, authWorld.alice) !== null);
eq("a stranger cannot — and gets the same null as a missing one",
  readable(authWorld.db, mine.id, authWorld.bob), null);
eq("a conversation that does not exist is also null",
  readable(authWorld.db, "11111111-2222-3333-4444-555555555555", authWorld.alice), null);
ok("so the two are indistinguishable to the caller — a 403 would confirm the id is real",
  readable(authWorld.db, mine.id, authWorld.bob) === readable(authWorld.db, "nope", authWorld.bob));

group("transcripts — a pre-016 conversation belongs to nobody");
// The migration left owner_id NULL rather than inventing an owner. NULL is not
// a wildcard: it is unreachable, not public.
authWorld.db.prepare("INSERT INTO conversations (id, created_at, persona) VALUES (?,?,?)")
  .run("legacy", T, "default");
eq("not readable by alice", readable(authWorld.db, "legacy", authWorld.alice), null);
eq("not readable by bob", readable(authWorld.db, "legacy", authWorld.bob), null);
ok("but the row is still there — it was not deleted, just orphaned",
  getConversation(authWorld.db, "legacy") !== null);

group("transcripts — listing is scoped to the owner");
createConversation(authWorld.db, "terse", authWorld.alice, T + 1);
createConversation(authWorld.db, "default", authWorld.bob, T + 2);
eq("alice sees only hers", listByOwner(authWorld.db, authWorld.alice).length, 2);
eq("bob sees only his", listByOwner(authWorld.db, authWorld.bob).length, 1);
ok("and no listing includes the orphan",
  [...listByOwner(authWorld.db, authWorld.alice), ...listByOwner(authWorld.db, authWorld.bob)]
    .every((c) => c.id !== "legacy"));
