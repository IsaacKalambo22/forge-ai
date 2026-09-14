import {
  SESSION_COOKIE, clearCookie, issueSession, readCookie, sessionCookie, verifySession,
} from "@/lib/session";
import { group, ok } from "./harness.mts";

const SECRET = "a-signing-key-for-tests";
const T = 1_700_000_000_000;

group("session — issue and verify");
const token = issueSession(SECRET, T);
let r = verifySession(token, SECRET, T);
ok("a freshly issued token verifies", r.valid);
ok("payload carries iat and exp", r.valid && r.payload.iat === T && r.payload.exp > T);
ok("token has exactly two parts", token.split(".").length === 2);
ok("token is base64url only (cookie-safe)", /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));

group("session — expiry");
ok("valid one ms before expiry", verifySession(token, SECRET, T + 12 * 60 * 60 * 1000 - 1).valid);
r = verifySession(token, SECRET, T + 12 * 60 * 60 * 1000);
ok("expired exactly at exp", !r.valid && r.reason === "expired");
r = verifySession(issueSession(SECRET, T, 1000), SECRET, T + 5000);
ok("a short-lived token expires", !r.valid && r.reason === "expired");

group("session — forgery");
r = verifySession(token, "a-different-signing-key", T);
ok("a token signed with another key is rejected", !r.valid && r.reason === "bad_signature");

// The classic attack: rewrite the payload to extend your own session.
const [encoded] = token.split(".");
const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString());
ok("the payload IS readable — it is signed, not encrypted", typeof decoded.exp === "number");
const tampered = Buffer.from(JSON.stringify({ ...decoded, exp: decoded.exp + 10 ** 9 })).toString("base64url");
r = verifySession(`${tampered}.${token.split(".")[1]}`, SECRET, T);
ok("extending exp invalidates the signature", !r.valid && r.reason === "bad_signature");

// A forged token with no MAC at all — the "alg: none" shape.
r = verifySession(`${tampered}.`, SECRET, T);
ok("a token with an empty MAC is rejected", !r.valid);
r = verifySession(tampered, SECRET, T);
ok("a token with no MAC section is rejected", !r.valid && r.reason === "malformed");

group("session — malformed input never throws");
for (const bad of ["", ".", "..", "a.b.c", "!!!.???", "a.", ".b", "null", "{}"]) {
  const result = verifySession(bad, SECRET, T);
  ok(`rejects ${JSON.stringify(bad)}`, !result.valid, result.valid ? "" : result.reason);
}
r = verifySession(`${Buffer.from("not json").toString("base64url")}.x`, SECRET, T);
ok("a valid-looking token with non-JSON payload is rejected", !r.valid);

group("session — cookie attributes are the security");
const secureCookie = sessionCookie(token, true, 3600);
ok("HttpOnly — JavaScript cannot read it (XSS defence)", secureCookie.includes("HttpOnly"));
ok("SameSite=Strict — CSRF defence", secureCookie.includes("SameSite=Strict"));
ok("Secure — HTTPS only", secureCookie.includes("Secure"));
ok("Path=/ — sent to the API routes too", secureCookie.includes("Path=/"));
ok("Secure is omitted on localhost (no HTTPS there)",
  !sessionCookie(token, false, 3600).split("; ").includes("Secure"));
ok("clearing sets Max-Age=0", clearCookie(true).includes("Max-Age=0"));

group("session — cookie parsing");
ok("reads the session cookie among others",
  readCookie(`theme=dark; ${SESSION_COOKIE}=abc123; other=1`, SESSION_COOKIE) === "abc123");
ok("returns null when absent", readCookie("theme=dark", SESSION_COOKIE) === null);
ok("returns null with no header", readCookie(null, SESSION_COOKIE) === null);
ok("tolerates whitespace", readCookie(`  ${SESSION_COOKIE} = spaced `, SESSION_COOKIE) === "spaced");
ok("does not match a name that merely ends with ours",
  readCookie(`not_${SESSION_COOKIE}=nope`, SESSION_COOKIE) === null);
