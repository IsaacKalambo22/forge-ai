import "server-only";

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { db } from "./db";

// Experiment 016. Real users, retiring Experiment 012's "one password, no
// users" note.
//
// PASSWORD HASHING IS THE OPPOSITE PROBLEM TO TOKEN HASHING.
//
// `revocation.ts` hashes session tokens with plain SHA-256, and that is correct
// there: the input is 256+ bits of MAC output, so there is no dictionary to
// attack and no reason to pay for slowness.
//
// A password is the opposite. It is short, human-chosen, and drawn from a space
// an attacker can enumerate. Against a leaked table, SHA-256's speed is the
// vulnerability — billions of guesses per second on a GPU. A password hash must
// be DELIBERATELY SLOW, and salted so that one table of precomputed hashes
// cannot attack every row at once.
//
// scrypt is used because Node ships it. It is memory-hard, which is what blunts
// the GPU advantage that makes SHA-256 hopeless here.

// 2^14 iterations. ~50-100ms per hash on this machine — slow enough to make
// large-scale guessing expensive, fast enough that a login is not annoying.
// This is a cost/security dial, not a constant handed down from anywhere.
const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;
const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/i;

/**
 * Encoded as `scrypt$N$r$p$salt$hash`.
 *
 * The PARAMETERS are stored with the hash, not just the digest. Without them a
 * future change to SCRYPT_N would make every existing password unverifiable —
 * the stored hash would be the output of a function you can no longer name.
 * Storing them is what makes it possible to raise the cost later and re-hash
 * each password on next login.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p,
  });
  return [
    "scrypt", SCRYPT_N, SCRYPT_r, SCRYPT_p,
    salt.toString("hex"), derived.toString("hex"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, hashHex] = parts;
  let expected: Buffer;
  let derived: Buffer;
  try {
    expected = Buffer.from(hashHex, "hex");
    derived = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
  } catch {
    // A malformed record must not throw a 500 into a login handler.
    return false;
  }

  // Constant time: a byte-by-byte early exit leaks how much of the hash matched.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export type User = {
  id: string;
  username: string;
  created_at: number;
};

export class UserError extends Error {}

export function createUser(
  database: DatabaseSync,
  username: string,
  password: string,
  now: number,
): User {
  if (!USERNAME_PATTERN.test(username)) {
    throw new UserError("Username must be 3-32 letters, digits, hyphen or underscore");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    // Unbounded input into a deliberately slow function is a denial-of-service
    // you have invited: the server does the expensive work, per request.
    throw new UserError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }

  const user: User = { id: randomUUID(), username, created_at: now };
  try {
    database
      .prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(user.id, username, hashPassword(password), now);
  } catch (error) {
    if (String((error as Error).message).includes("UNIQUE")) {
      throw new UserError("Username is taken");
    }
    throw error;
  }
  return user;
}

export function findByUsername(database: DatabaseSync, username: string): User | null {
  const row = database
    .prepare("SELECT id, username, created_at FROM users WHERE username = ?")
    .get(username) as User | undefined;
  return row ?? null;
}

export function findById(database: DatabaseSync, id: string): User | null {
  const row = database
    .prepare("SELECT id, username, created_at FROM users WHERE id = ?")
    .get(id) as User | undefined;
  return row ?? null;
}

/**
 * Returns the user on a correct password, else null.
 *
 * An unknown username still pays for a scrypt call against a dummy hash. Without
 * that, a wrong username returns in microseconds and a wrong password takes
 * ~80ms — a timing oracle that tells an attacker which usernames exist, and
 * enumerating accounts is the first step of attacking them.
 */
const DUMMY_HASH = hashPassword("timing-equalisation-dummy-value");

export function authenticate(
  database: DatabaseSync,
  username: string,
  password: string,
): User | null {
  const row = database
    .prepare("SELECT id, username, password_hash, created_at FROM users WHERE username = ?")
    .get(username) as (User & { password_hash: string }) | undefined;

  if (row === undefined) {
    verifyPassword(password, DUMMY_HASH);
    return null;
  }

  if (!verifyPassword(password, row.password_hash)) return null;

  return { id: row.id, username: row.username, created_at: row.created_at };
}

/**
 * The local-development identity.
 *
 * Without APP_SECRET the project has always been open locally, so that `curl`
 * works with no ceremony. Experiment 016 makes every conversation owned, which
 * would otherwise make "open" incoherent — an unowned request cannot own
 * anything. So local development acts as one fixed user instead of as nobody.
 *
 * This is a development affordance and nothing else. In production an unset
 * APP_SECRET already fails closed with a 503 (Experiment 011), so this user is
 * unreachable there. Its password hash is deliberately unusable: it is a random
 * value nobody holds, so the account cannot be logged into even if the
 * environment is misconfigured.
 */
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000000";

export function ensureDevUser(database: DatabaseSync, now: number): string {
  const existing = findById(database, DEV_USER_ID);
  if (existing !== null) return DEV_USER_ID;

  database
    .prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(DEV_USER_ID, "local-dev", hashPassword(randomBytes(32).toString("hex")), now);
  return DEV_USER_ID;
}

export function countUsers(database: DatabaseSync): number {
  return (database.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

// ---------------------------------------------------------------------------

export const users = {
  create: (username: string, password: string) => createUser(db(), username, password, Date.now()),
  authenticate: (username: string, password: string) => authenticate(db(), username, password),
  byId: (id: string) => findById(db(), id),
  ensureDev: () => ensureDevUser(db(), Date.now()),
  count: () => countUsers(db()),
};
