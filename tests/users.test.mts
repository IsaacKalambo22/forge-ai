// Experiment 016.
import { openDatabase } from "@/lib/db";
import {
  hashPassword, verifyPassword, createUser, authenticate, findByUsername, findById,
  countUsers, MIN_PASSWORD_LENGTH,
} from "@/lib/users";
import { group, ok, eq, throws } from "./harness.mts";

const T = 1_700_000_000_000;
const fresh = () => openDatabase(":memory:");
const PASSWORD = "correct-horse-battery";

group("users — password hashing");
const h = hashPassword(PASSWORD);
ok("verifies the right password", verifyPassword(PASSWORD, h));
ok("rejects the wrong one", !verifyPassword("wrong-horse-battery", h));
ok("rejects an empty password", !verifyPassword("", h));
ok("the password is not in the stored value", !h.includes(PASSWORD));

group("users — the hash is salted");
// Two users with the SAME password must not share a hash. Otherwise one leaked
// table shows an attacker which accounts to attack once and reuse.
const a = hashPassword(PASSWORD);
const b = hashPassword(PASSWORD);
ok("same password, different hashes", a !== b, `${a.slice(0, 22)}… vs ${b.slice(0, 22)}…`);
ok("and both still verify", verifyPassword(PASSWORD, a) && verifyPassword(PASSWORD, b));

group("users — parameters travel with the hash");
// Without them, raising the cost later would make every existing password
// unverifiable: the stored digest is the output of a function you can no
// longer name.
const [scheme, n, r, p, salt, digest] = h.split("$");
eq("scheme is recorded", scheme, "scrypt");
ok("cost parameters are recorded", Number(n) >= 16384 && Number(r) > 0 && Number(p) > 0,
  `N=${n} r=${r} p=${p}`);
ok("salt is present and random-looking", /^[0-9a-f]{32}$/.test(salt));
ok("digest is present", /^[0-9a-f]{128}$/.test(digest));

group("users — hashing is deliberately slow");
// The defining property. Against a leaked table, SHA-256's SPEED is the
// vulnerability. This asserts the cost has not been accidentally turned off.
const started = Date.now();
verifyPassword(PASSWORD, h);
const elapsed = Date.now() - started;
ok("a single verification takes real time", elapsed >= 10, `${elapsed} ms`);

group("users — malformed stored hashes do not throw");
// A login handler must not 500 on a bad row.
ok("garbage", !verifyPassword(PASSWORD, "not-a-hash"));
ok("wrong field count", !verifyPassword(PASSWORD, "scrypt$1$2$3"));
ok("unknown scheme", !verifyPassword(PASSWORD, "bcrypt$1$2$3$aa$bb"));
ok("empty", !verifyPassword(PASSWORD, ""));

group("users — create and find");
const d = fresh();
const alice = createUser(d, "alice", PASSWORD, T);
eq("user count", countUsers(d), 1);
eq("found by username", findByUsername(d, "alice")?.id, alice.id);
eq("found by id", findById(d, alice.id)?.username, "alice");
eq("unknown username is null", findByUsername(d, "nobody"), null);
ok("id is a UUID, not a counter", /^[0-9a-f-]{36}$/.test(alice.id));

group("users — usernames are unique, case-insensitively");
throws("the same username", () => createUser(d, "alice", PASSWORD, T));
throws("a different case is still the same user", () => createUser(d, "ALICE", PASSWORD, T));
eq("still only one user", countUsers(d), 1);

group("users — input rules");
throws("username too short", () => createUser(d, "ab", PASSWORD, T));
throws("username with a space", () => createUser(d, "not valid", PASSWORD, T));
throws("username with punctuation", () => createUser(d, "a@b.com", PASSWORD, T));
throws(`password under ${MIN_PASSWORD_LENGTH} chars`, () => createUser(d, "bob", "short", T));
// Unbounded input into a deliberately slow function is an invitation to make
// the server do expensive work per request.
throws("absurdly long password", () => createUser(d, "carol", "x".repeat(5000), T));

group("users — authenticate");
eq("correct password returns the user", authenticate(d, "alice", PASSWORD)?.id, alice.id);
eq("wrong password returns null", authenticate(d, "alice", "wrong-password-here"), null);
eq("unknown user returns null", authenticate(d, "nobody", PASSWORD), null);
ok("the password hash never leaves the module",
  !Object.keys(authenticate(d, "alice", PASSWORD) ?? {}).includes("password_hash"),
  Object.keys(authenticate(d, "alice", PASSWORD) ?? {}).join(","));

group("users — an unknown username is not faster than a wrong password");
// A timing oracle here tells an attacker which usernames exist, and enumerating
// accounts is the first step of attacking them.
const time = (fn: () => void) => { const s = Date.now(); fn(); return Date.now() - s; };
const unknownMs = time(() => authenticate(d, "definitely-not-a-user", PASSWORD));
const wrongMs = time(() => authenticate(d, "alice", "wrong-password-here"));
ok("the unknown-user path also pays for a hash", unknownMs >= 10,
  `unknown ${unknownMs}ms vs wrong-password ${wrongMs}ms`);

group("users — survives a restart");
const path = `${process.env.TMPDIR ?? "/tmp"}/forge-users-${Math.random().toString(36).slice(2)}.db`;
const before = openDatabase(path);
const persisted = createUser(before, "dave", PASSWORD, T);
before.close();
const after = openDatabase(path);
eq("the user is still there", findById(after, persisted.id)?.username, "dave");
ok("and can still log in", authenticate(after, "dave", PASSWORD) !== null);
after.close();
