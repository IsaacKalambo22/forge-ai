import { guard, rateLimit } from "@/lib/guard";
import { SESSION_TTL_MS, clearCookie, issueSession, sessionCookie } from "@/lib/session";

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

  const secure = process.env.NODE_ENV === "production";
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie(secure) } });
}
