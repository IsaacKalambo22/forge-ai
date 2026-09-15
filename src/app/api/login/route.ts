import { guard, rateLimit } from "@/lib/guard";
import {
  SESSION_COOKIE, SESSION_TTL_MS, clearCookie, issueSession, readCookie, sessionCookie,
  verifySession,
} from "@/lib/session";
import { revocations } from "@/lib/revocation";

export async function POST(request: Request) {
  // Rate-limited but NOT auth-checked — a login endpoint cannot require
  // authentication, and an unlimited one is an offer to brute-force the secret.
  // 20 attempts, then 1 every 3 seconds.
  const limited = rateLimit(request, "search");
  if (limited !== null) return limited;

  const secret = process.env.APP_SECRET;

  if (secret === undefined || secret === "") {
    return Response.json({ error: "No password is configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { password } = (body ?? {}) as { password?: unknown };

  if (typeof password !== "string") {
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  // Constant-time comparison, via the same helper path as the Bearer check.
  const provided = Buffer.from(password);
  const expected = Buffer.from(secret);
  const match =
    provided.length === expected.length &&
    (await import("node:crypto")).timingSafeEqual(provided, expected);

  if (!match) {
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = issueSession(secret, Date.now());
  // Secure requires HTTPS, which localhost does not have.
  const secure = process.env.NODE_ENV === "production";

  return Response.json(
    { ok: true },
    {
      status: 200,
      headers: {
        "Set-Cookie": sessionCookie(token, secure, SESSION_TTL_MS / 1000),
      },
    },
  );
}

export async function DELETE(request: Request) {
  const denied = guard(request, "search");
  if (denied !== null) return denied;

  // Experiment 015. Clearing the cookie only asks the BROWSER to forget the
  // token; anyone who copied it still holds a validly-signed credential. Before
  // 015 that was the whole of logout, and Experiment 012 recorded it as a known
  // hole. Now the token goes on the denylist for the rest of its lifetime.
  const secret = process.env.APP_SECRET;
  const cookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE);

  if (cookie !== null && secret !== undefined && secret !== "") {
    const result = verifySession(cookie, secret, Date.now());
    if (result.valid) {
      // Revoke until its own expiry — past that the signature check rejects it
      // anyway, and the row would be dead weight.
      revocations.revoke(cookie, result.payload.exp);
    }
    // Opportunistic housekeeping: logout is the natural moment to drop rows
    // whose tokens have expired, and it keeps the table from growing forever
    // without needing a scheduler this project does not have.
    revocations.purge();
  }

  const secure = process.env.NODE_ENV === "production";
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie(secure) } });
}
