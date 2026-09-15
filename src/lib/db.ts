import "server-only";

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Why SQLite, and why this one.
//
// Three experiments recorded the same missing thing: 003 (client-held history
// is forgeable), 011 and 014 (in-process state dies on restart), 012 (sessions
// cannot be revoked). All of them need somewhere durable to put a fact.
//
// `node:sqlite` ships WITH Node 24 — no npm install, no service to run, no
// credential. That matters here beyond convenience: this project has one
// runtime dependency it did not write, deliberately, and a database was not
// going to be the second. It is also the honest choice for a single process on
// a laptop. Postgres is the answer when there is more than one process, and
// that is the point at which the interface below should be reconsidered.
//
// It is a real database: durable across restarts, ACID transactions, actual
// SQL. What it is NOT is shared between machines.

/** Each migration runs once, in order. Never edit one that has shipped — append. */
const MIGRATIONS: string[] = [
  // 1 — conversations and their turns.
  //
  // The fix for Experiment 003: the server keeps the transcript, so an
  // assistant turn is something the server RECORDED rather than something the
  // client CLAIMED.
  `
  CREATE TABLE conversations (
    id          TEXT PRIMARY KEY,
    created_at  INTEGER NOT NULL,
    persona     TEXT NOT NULL
  );

  CREATE TABLE turns (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    seq             INTEGER NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    UNIQUE (conversation_id, seq)
  );

  CREATE INDEX turns_by_conversation ON turns (conversation_id, seq);
  `,

  // 2 — revoked sessions.
  //
  // The fix for Experiment 012: a signed token cannot be un-signed, so logout
  // could only clear the client's cookie and a stolen token stayed valid for up
  // to 12 hours. A server-side denylist is what makes revocation real.
  //
  // A DENYlist rather than an allowlist, deliberately: an allowlist would mean
  // a database read on every single authenticated request, which throws away
  // the reason stateless tokens were chosen in 012. This costs one read only
  // while tokens that were explicitly revoked are still inside their lifetime.
  `
  CREATE TABLE revoked_sessions (
    token_hash  TEXT PRIMARY KEY,
    revoked_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );

  CREATE INDEX revoked_by_expiry ON revoked_sessions (expires_at);
  `,

  // 3 — users, and ownership of conversations.
  //
  // Experiment 015 made conversations durable and left them unowned. The
  // project could tell that a session was valid and could not tell whether a
  // conversation belonged to it.
  //
  // `owner_id` is NULLABLE, and that is a decision rather than a shortcut.
  // Adding a NOT NULL column to a populated table forces you to say what the
  // EXISTING rows mean, and the only truthful answer here is "nobody knows" —
  // these conversations predate the concept of an owner. Inventing an owner for
  // them would be fabricating a fact. They are left NULL, and the authorization
  // check below treats NULL as "not yours", so they become unreachable rather
  // than misattributed.
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  ALTER TABLE conversations ADD COLUMN owner_id TEXT REFERENCES users(id);

  CREATE INDEX conversations_by_owner ON conversations (owner_id);
  `,

  // 4 — the usage ledger.
  //
  // Experiment 011 caps spending by counting REQUESTS, which is a proxy: one
  // request can be six upstream calls, and a long conversation costs many times
  // a short one. 014 wanted token counts and had no `usage` object to record.
  // 015 built a durable store and put no billing facts in it.
  //
  // `cost_nanodollars` is an INTEGER, and that is the point — see pricing.ts.
  // Money stored as a float reconciles with nothing once it is summed.
  //
  // `request_id` is the correlation id from 014, so a row here and a log line
  // there are the same request. UNIQUE, so a retry cannot double-bill.
  `
  CREATE TABLE usage (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id        TEXT NOT NULL UNIQUE,
    user_id           TEXT REFERENCES users(id),
    conversation_id   TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    route             TEXT NOT NULL,
    model             TEXT NOT NULL,
    input_tokens      INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens     INTEGER NOT NULL CHECK (output_tokens >= 0),
    cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
    cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
    cost_nanodollars  INTEGER NOT NULL CHECK (cost_nanodollars >= 0),
    created_at        INTEGER NOT NULL
  );

  CREATE INDEX usage_by_user_time ON usage (user_id, created_at);
  CREATE INDEX usage_by_time ON usage (created_at);
  `,

  // 5 — the embedding cache.
  //
  // Experiment 023 measured the notebook index at 256 chunks and 516.6 seconds
  // to build, ~850 MB, REBUILT FROM SCRATCH ON EVERY RESTART. It was 65 chunks
  // in Experiment 008; every README written makes it worse.
  //
  // Keyed by a hash of the TEXT, not by file or position. A chunk that moves to
  // another file, or shifts down a document as text is inserted above it, is
  // still the same chunk and must not be re-embedded. Editing one section of
  // one experiment should cost one embedding, not 256.
  //
  // `model` is part of the key because vectors from different models are not
  // comparable — mixing them silently produces meaningless similarities rather
  // than an error.
  `
  CREATE TABLE embeddings (
    hash       TEXT NOT NULL,
    model      TEXT NOT NULL,
    dims       INTEGER NOT NULL,
    vector     BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (hash, model)
  );
  `,

  // 6 — move the embedding cache OUT of this database.
  //
  // Experiment 025. Migration 5 put it here because 015 had already built this
  // file. That was a mistake of category, not of schema: this database holds
  // durable APPLICATION STATE — users, transcripts, sessions, a financial
  // ledger. The embedding cache is DERIVED DATA. It can be deleted at any time
  // and rebuilt, it is identical for everyone running the same corpus, and it
  // is the one thing here that is safe to ship, share or cache in CI.
  //
  // Mixing the two meant CI could not cache the vectors without also caching a
  // user table, and nothing could be safely deleted to reclaim space.
  //
  // Dropped rather than left in place: an unused table is a trap for the next
  // person, who will reasonably assume something writes to it. Migration 5 is
  // left exactly as it shipped — the rule is append, never edit.
  `
  DROP TABLE IF EXISTS embeddings;
  `,
];

/**
 * Opens a database and brings its schema up to date.
 *
 * Migration state lives in SQLite's own `user_version` pragma — an integer the
 * database carries for exactly this purpose. No migrations table to bootstrap,
 * and the version travels with the file, so a copied database cannot disagree
 * with itself about which migrations it has had.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);

  // Enforce the REFERENCES clauses above. SQLite ignores foreign keys unless
  // asked — a default kept for backward compatibility, and a trap: the
  // constraint is written, looks enforced, and is not.
  db.exec("PRAGMA foreign_keys = ON");

  // Write-ahead logging: readers do not block the writer. Harmless on one
  // process, and the right default the moment there are concurrent requests.
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");

  migrate(db);
  return db;
}

/** Applies any migrations the database has not seen. Safe to call repeatedly. */
export function migrate(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const current = row.user_version;

  if (current > MIGRATIONS.length) {
    // The file was written by a NEWER version of this code. Running anyway
    // would mean operating on a schema this build does not understand.
    throw new Error(
      `Database is at version ${current}; this build only knows ${MIGRATIONS.length}`,
    );
  }

  for (let version = current; version < MIGRATIONS.length; version++) {
    // Each migration is one transaction: it applies completely or not at all,
    // so an interrupted deploy cannot leave a half-built schema.
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      // The pragma will not take a bound parameter, and `version + 1` is a
      // number from this file's own loop — not user input.
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${version + 1} failed: ${(error as Error).message}`);
    }
  }

  return MIGRATIONS.length;
}

export const SCHEMA_VERSION = MIGRATIONS.length;

// ---------------------------------------------------------------------------
// The process-wide instance. Opened lazily so importing this module does not
// touch the filesystem — which is what lets the tests open their own.
// ---------------------------------------------------------------------------

const DEFAULT_PATH = process.env.FORGE_DB_PATH ?? ".data/forge.db";

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  instance ??= openDatabase(DEFAULT_PATH);
  return instance;
}
