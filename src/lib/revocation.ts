import "server-only";

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { db } from "./db";

// The fix for Experiment 012.
//
// 012 recorded the limitation plainly:
//
//   "Sessions cannot be revoked before expiry — there is no server-side session
//    list, so logout only clears the client's cookie. A stolen token stays
//    valid for up to 12 hours."
//
// That is inherent to a signed token: the server holds no state, so there is
// nothing to delete. Verification is a signature check and arithmetic, and both
// keep succeeding for a token that has been "logged out".
//
// A DENYLIST, not an allowlist — and the difference is the whole design.
//
//   Allowlist: every authenticated request reads the database to confirm the
//              session still exists. Correct, and it throws away the reason
//              stateless tokens were chosen in the first place.
//   Denylist:  a request reads the database only to check a small table of
//              tokens explicitly revoked and not yet expired. Usually empty.
//
// What the denylist costs: revocation is not free, and the table must be
// purged, or it grows forever with entries that stopped mattering the moment
// their token expired anyway.

/**
 * The table stores a HASH of the token, never the token.
 *
 * A list of un-expired session tokens is a list of live credentials. Storing
 * them raw means a database leak hands over every session it was supposed to be
 * protecting — the denylist would become the most dangerous table in the
 * schema. SHA-256 is right here where a password would need a slow KDF: the
 * input is 256+ bits of MAC output, so there is no dictionary to attack.
 */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Revokes a token until `expiresAt` — after which the signature check rejects
 * it anyway and the row is only taking up space.
 */
export function revoke(
  database: DatabaseSync,
  token: string,
  expiresAt: number,
  now: number,
): void {
  database
    .prepare(
      // Revoking twice is not an error. Logging out of an already-logged-out
      // session should be a no-op, not a 500.
      "INSERT INTO revoked_sessions (token_hash, revoked_at, expires_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(token_hash) DO NOTHING",
    )
    .run(tokenHash(token), now, expiresAt);
}

export function isRevoked(database: DatabaseSync, token: string): boolean {
  const row = database
    .prepare("SELECT 1 AS hit FROM revoked_sessions WHERE token_hash = ?")
    .get(tokenHash(token)) as { hit: number } | undefined;
  return row !== undefined;
}

/**
 * Drops rows whose tokens have expired.
 *
 * Not an optimisation — without it this table is an unbounded, permanently
 * growing record of every logout the service has ever handled, which is the
 * same slow-fuse leak the telemetry ring buffer was built to avoid in 014.
 */
export function purgeExpired(database: DatabaseSync, now: number): number {
  const before = countRevoked(database);
  database.prepare("DELETE FROM revoked_sessions WHERE expires_at <= ?").run(now);
  return before - countRevoked(database);
}

export function countRevoked(database: DatabaseSync): number {
  return (database.prepare("SELECT COUNT(*) AS n FROM revoked_sessions").get() as { n: number }).n;
}

// ---------------------------------------------------------------------------
// Process-wide wrappers.
// ---------------------------------------------------------------------------

export const revocations = {
  revoke: (token: string, expiresAt: number) => revoke(db(), token, expiresAt, Date.now()),
  isRevoked: (token: string) => isRevoked(db(), token),
  purge: () => purgeExpired(db(), Date.now()),
};
