// Signed session tokens. The secret is a PARAMETER, not read from the
// environment here — which keeps this module pure enough to test exhaustively
// and means the signing key never has a second place it could leak from.
//
// Format:  <base64url(payload)>.<base64url(hmac-sha256)>
//
// The token is signed, NOT encrypted. Its contents are readable by the holder
// and that is fine: it carries no secret, only a claim the server can verify.
// What the holder cannot do is change it, because they cannot produce the MAC.
import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionPayload = {
  /** Issued at, epoch milliseconds. */
  iat: number;
  /** Expires at, epoch milliseconds. */
  exp: number;
};

export const SESSION_COOKIE = "forge_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function b64url(input: Buffer): string {
  return input.toString("base64url");
}

function mac(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function issueSession(secret: string, now: number, ttlMs = SESSION_TTL_MS): string {
  const payload: SessionPayload = { iat: now, exp: now + ttlMs };
  const encoded = b64url(Buffer.from(JSON.stringify(payload)));
  return `${encoded}.${b64url(mac(encoded, secret))}`;
}

export type SessionResult =
  | { valid: true; payload: SessionPayload }
  | { valid: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifySession(token: string, secret: string, now: number): SessionResult {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    return { valid: false, reason: "malformed" };
  }

  const [encoded, providedMac] = parts;

  // Signature FIRST, before the payload is parsed or trusted in any way. A
  // token whose MAC does not verify is attacker-authored, and parsing
  // attacker-authored JSON to decide whether to check the signature is how you
  // end up trusting the `alg: none` of your own design.
  const expected = mac(encoded, secret);
  let provided: Buffer;
  try {
    provided = Buffer.from(providedMac, "base64url");
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (provided.length !== expected.length) {
    return { valid: false, reason: "bad_signature" };
  }
  if (!timingSafeEqual(provided, expected)) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (typeof payload?.exp !== "number" || typeof payload?.iat !== "number") {
    return { valid: false, reason: "malformed" };
  }
  if (now >= payload.exp) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}

/**
 * The cookie attributes are the security, not the token.
 *
 *   HttpOnly  — JavaScript cannot read it, so an XSS bug cannot steal the session
 *   SameSite  — not sent on cross-site requests, which is CSRF protection
 *   Secure    — HTTPS only (relaxed on localhost, which has no HTTPS)
 *   Path=/    — sent to the API routes, not just the page
 */
export function sessionCookie(token: string, secure: boolean, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearCookie(secure: boolean): string {
  return sessionCookie("", secure, 0);
}

/** Minimal cookie-header parsing — we need exactly one name. */
export function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}
