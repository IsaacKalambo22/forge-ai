// Experiment 015. The revocation debt from Experiment 012.
import { openDatabase } from "@/lib/db";
import { revoke, isRevoked, purgeExpired, countRevoked, tokenHash } from "@/lib/revocation";
import { issueSession, verifySession, SESSION_TTL_MS } from "@/lib/session";
import { group, ok, eq } from "./harness.mts";

const T = 1_700_000_000_000;
const SECRET = "test-secret-value";
const fresh = () => openDatabase(":memory:");

group("revocation — the basic contract");
const d = fresh();
const token = issueSession(SECRET, T);
ok("a fresh token is not revoked", !isRevoked(d, token));
revoke(d, token, T + SESSION_TTL_MS, T);
ok("after revoking, it is", isRevoked(d, token));
ok("a different token is unaffected", !isRevoked(d, issueSession(SECRET, T + 1)));

group("revocation — revoking twice is a no-op, not an error");
revoke(d, token, T + SESSION_TTL_MS, T);
eq("still one row", countRevoked(d), 1);

group("revocation — THE Experiment 012 FIX");
// 012: "logout only clears the client's cookie. A stolen token stays valid for
// up to 12 hours." The signature check cannot see a logout, so this asserts
// BOTH halves: the token is still cryptographically valid, and rejected anyway.
const stolen = issueSession(SECRET, T);
const later = T + 60_000; // one minute after issue; 11h59m of life left
eq("the signature still verifies", verifySession(stolen, SECRET, later).valid, true);
ok("…which is exactly why signature checking alone was not enough",
  verifySession(stolen, SECRET, later).valid === true);
revoke(d, stolen, T + SESSION_TTL_MS, later);
ok("the denylist rejects it despite a valid signature", isRevoked(d, stolen));

group("revocation — the table stores hashes, not tokens");
// A list of un-expired session tokens is a list of live credentials. If this
// table leaked, storing them raw would hand over every session it protects.
const raw = fresh();
const secretToken = issueSession(SECRET, T);
revoke(raw, secretToken, T + SESSION_TTL_MS, T);
const stored = (raw.prepare("SELECT token_hash FROM revoked_sessions").get() as
  { token_hash: string }).token_hash;
ok("the token itself is not in the table", stored !== secretToken);
ok("what is stored is not usable as a token", verifySession(stored, SECRET, T).valid === false);
eq("it is a sha-256 hex digest", /^[0-9a-f]{64}$/.test(stored), true);
eq("and it is the hash of that token", stored, tokenHash(secretToken));

group("revocation — purging expired rows");
const p = fresh();
revoke(p, "already-expired", T - 1, T - 10_000);
revoke(p, "expires-later", T + SESSION_TTL_MS, T);
eq("two rows", countRevoked(p), 2);
eq("purge drops only the expired one", purgeExpired(p, T), 1);
eq("one row left", countRevoked(p), 1);
ok("the live revocation survives", isRevoked(p, "expires-later"));
ok("the expired one is gone — its token is rejected by expiry anyway",
  !isRevoked(p, "already-expired"));
eq("purging again removes nothing", purgeExpired(p, T), 0);

group("revocation — survives a restart");
// The property that makes this a fix rather than a gesture: a logout must
// outlive the process, or restarting the server un-revokes every session.
const path = `${process.env.TMPDIR ?? "/tmp"}/forge-rev-${Math.random().toString(36).slice(2)}.db`;
const before = openDatabase(path);
const revokedToken = issueSession(SECRET, T);
revoke(before, revokedToken, T + SESSION_TTL_MS, T);
before.close();

const after = openDatabase(path);
ok("still revoked after a reopen", isRevoked(after, revokedToken));
after.close();
