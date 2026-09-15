import { guard, rateLimit } from "@/lib/guard";
import {
  SESSION_COOKIE, SESSION_TTL_MS, clearCookie, issueSession, readCookie, sessionCookie,
  verifySession,
} from "@/lib/session";
import { revocations } from "@/lib/revocation";
import { users, UserError } from "@/lib/users";
import { observe } from "@/lib/observe";

// Experiment 016 changed what this endpoint is.
//
//   before   POST { password }            — one shared secret, no identity
//   after    POST { username, password }  — a person, with a session that says who
//
// APP_SECRET changed role at the same time. It used to BE the password. It is
// now the key that signs sessions and the credential that authorizes
// registration — an operator secret, not a user one.

export async function POST(request: Request) {
  return observe("login", () => handle(request));
}

async function handle(request: Request) {
  // Rate-limited but NOT auth-checked — a login endpoint cannot require
  // authentication, and an unlimited one is an offer to brute-force a password.
  const limited = rateLimit(request, "search");
  if (limited !== null) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };

  if (typeof username !== "string" || typeof password !== "string") {
    // Deliberately the same message and status as a wrong password: saying
    // "malformed" here and "incorrect" there is a distinction an attacker can
    // probe.
    return Response.json({ error: "Incorrect username or password" }, { status: 401 });
  }

  const user = users.authenticate(username, password);

  if (user === null) {
    // One message for "no such user" and "wrong password". Distinguishing them
    // hands over which usernames exist; `authenticate()` equalises the timing
    // so the response time does not give away what the message conceals.
    return Response.json({ error: "Incorrect username or password" }, { status: 401 });
  }

  const secret = process.env.APP_SECRET;
  if (secret === undefined || secret === "") {
    return Response.json({ error: "Server is not configured for sessions" }, { status: 503 });
  }

  // The session now carries WHO. Before 016 it carried only "this bearer knew
  // the password", which is authentication with nobody to authenticate.
  const token = issueSession(secret, user.id, Date.now());
  const secure = process.env.NODE_ENV === "production";

  return Response.json(
    { ok: true, username: user.username },
    { status: 200, headers: { "Set-Cookie": sessionCookie(token, secure, SESSION_TTL_MS / 1000) } },
  );
}

/**
 * Registration, gated by APP_SECRET.
 *
 * An open registration endpoint on a service that spends money per request is
 * an invitation. Requiring the operator secret makes this an invite: whoever
 * runs the server creates the accounts. It is the simplest gate that is not
 * "anyone", and it needs no email flow, which is an experiment of its own.
 */
export async function PUT(request: Request) {
  return observe("register", async () => {
    const limited = rateLimit(request, "search");
    if (limited !== null) return limited;

    const secret = process.env.APP_SECRET;
    if (secret === undefined || secret === "") {
      return Response.json(
        { error: "Registration requires APP_SECRET to be configured" },
        { status: 503 },
      );
    }

    // Only the operator credential opens this, never a user session: a
    // logged-in user must not be able to mint more accounts.
    const header = request.headers.get("authorization") ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (bearer !== secret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
    if (typeof username !== "string" || typeof password !== "string") {
      return Response.json({ error: "username and password are required" }, { status: 400 });
    }

    try {
      const user = users.create(username, password);
      return Response.json({ ok: true, id: user.id, username: user.username }, { status: 201 });
    } catch (error) {
      if (error instanceof UserError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  });
}

export async function DELETE(request: Request) {
  return observe("logout", async () => {
    const auth = guard(request, "search");
    if (auth instanceof Response) return auth;

    // Experiment 015. Clearing the cookie only asks the BROWSER to forget the
    // token; anyone who copied it still holds a validly-signed credential.
    const secret = process.env.APP_SECRET;
    const cookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE);

    if (cookie !== null && secret !== undefined && secret !== "") {
      const result = verifySession(cookie, secret, Date.now());
      if (result.valid) revocations.revoke(cookie, result.payload.exp);
      revocations.purge();
    }

    const secure = process.env.NODE_ENV === "production";
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie(secure) } });
  });
}
