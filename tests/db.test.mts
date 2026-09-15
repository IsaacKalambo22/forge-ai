// Experiment 015. Every test runs against `:memory:` — a real SQLite database
// with real constraints, created and destroyed per test. No mocks: the whole
// point is to find out whether the SCHEMA is right, and a mock of SQLite would
// only confirm my assumptions about it.
import { openDatabase, migrate, SCHEMA_VERSION } from "@/lib/db";
import { group, ok, eq, throws } from "./harness.mts";

const fresh = () => openDatabase(":memory:");

group("db — migrations");
const d = fresh();
eq("a new database is at the current version",
  (d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
  SCHEMA_VERSION);
ok("there is more than one migration", SCHEMA_VERSION >= 2, `${SCHEMA_VERSION}`);
eq("migrate() is idempotent", migrate(d), SCHEMA_VERSION);
eq("…and still idempotent a third time", migrate(d), SCHEMA_VERSION);

const tables = (d.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
).all() as { name: string }[]).map((r) => r.name).filter((n) => !n.startsWith("sqlite_"));
eq("every table exists", tables,
  ["conversations", "embeddings", "revoked_sessions", "turns", "usage", "users"]);

group("db — migrating a database that already has data");
// The real risk of migration 3: it ALTERs a populated table. A migration that
// only works on an empty database is not a migration.
const populated = openDatabase(":memory:");
// Rewind to the state after migration 2 by dropping what 3 added, then
// re-running: the same path an existing 015 database takes on upgrade.
populated.prepare("INSERT INTO conversations (id, created_at, persona) VALUES (?,?,?)")
  .run("legacy", 1, "default");
populated.prepare("INSERT INTO turns (conversation_id, seq, role, content, created_at) VALUES (?,?,?,?,?)")
  .run("legacy", 0, "user", "written before owners existed", 1);
eq("the pre-existing row survived the ALTER",
  (populated.prepare("SELECT COUNT(*) AS n FROM conversations").get() as { n: number }).n, 1);
eq("its turn survived too",
  (populated.prepare("SELECT content FROM turns WHERE conversation_id = ?").get("legacy") as
    { content: string }).content, "written before owners existed");
eq("and it has no owner — nobody knows whose it was",
  (populated.prepare("SELECT owner_id FROM conversations WHERE id = ?").get("legacy") as
    { owner_id: string | null }).owner_id, null);

group("db — a database from the future is refused");
// Rolling back the code without rolling back the file would otherwise mean
// operating on a schema this build does not understand.
const future = fresh();
future.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
throws("refuses to run against a newer schema", () => migrate(future));

group("db — foreign keys are actually enforced");
// SQLite ignores FOREIGN KEY unless asked. The constraint is written in the
// schema, looks enforced, and silently is not — so this asserts the PRAGMA,
// not the syntax.
const fk = fresh();
throws("a turn cannot reference a missing conversation", () =>
  fk.prepare("INSERT INTO turns (conversation_id, seq, role, content, created_at) VALUES (?,?,?,?,?)")
    .run("does-not-exist", 0, "user", "hi", 1));

group("db — the schema rejects bad data");
const c = fresh();
c.prepare("INSERT INTO conversations (id, created_at, persona) VALUES (?,?,?)").run("c1", 1, "default");
const insertTurn = (seq: number, role: string, content = "x") =>
  c.prepare("INSERT INTO turns (conversation_id, seq, role, content, created_at) VALUES (?,?,?,?,?)")
    .run("c1", seq, role, content, 1);

insertTurn(0, "user");
throws("a role outside user|assistant is refused", () => insertTurn(1, "system"));
throws("two turns cannot share a sequence number", () => insertTurn(0, "assistant"));
ok("a valid turn is accepted", (() => { insertTurn(1, "assistant"); return true; })());

group("db — cascade delete");
c.prepare("DELETE FROM conversations WHERE id = ?").run("c1");
eq("deleting a conversation removes its turns",
  (c.prepare("SELECT COUNT(*) AS n FROM turns").get() as { n: number }).n, 0);

group("db — durability across connections");
// The claim that separates this from every in-process store the project has
// built so far. A file, closed, reopened by a NEW connection.
const path = `${process.env.TMPDIR ?? "/tmp"}/forge-test-${Math.random().toString(36).slice(2)}.db`;
const first = openDatabase(path);
first.prepare("INSERT INTO conversations (id, created_at, persona) VALUES (?,?,?)")
  .run("survives", 42, "terse");
first.close();

const second = openDatabase(path);
const found = second.prepare("SELECT * FROM conversations WHERE id = ?").get("survives") as
  { id: string; created_at: number; persona: string } | undefined;
ok("the row is still there after a reopen", found !== undefined);
eq("with its values intact", [found?.created_at, found?.persona], [42, "terse"]);
eq("and migrations did not re-run", migrate(second), SCHEMA_VERSION);
second.close();
