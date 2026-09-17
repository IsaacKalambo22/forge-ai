# Experiment 040 — The CSRF Token That Isn't Needed

## Objective

README's Deferred list has carried this since the `PUT /api/login` registration
endpoint was added: "CSRF token — slightly more pressing now there is a
state-changing `PUT`." Unlike Experiments 037–039, this one did not end with new
production code. It ended with evidence that the listed gap was already closed,
and closing a Deferred item honestly sometimes means saying so rather than adding
a mechanism the codebase does not need.

## What happened — checking the claim instead of building against it

CSRF works by exploiting a browser's habit of attaching ambient credentials
(cookies) to a request automatically, whatever site the request came from. Two
questions decide whether it applies here: does every state-changing route reach
its credential through a cookie, and does the cookie travel cross-site?

**Every cookie this application ever issues, checked at the source.**

```bash
$ grep -rn "Set-Cookie" src/
src/app/api/login/route.ts:66:   sessionCookie(token, secure, SESSION_TTL_MS / 1000)
src/app/api/login/route.ts:140:  clearCookie(secure)
```

One cookie (`forge_session`), one issuing function (`sessionCookie()` in
`src/lib/session.ts`), unconditionally set with `SameSite=Strict`:

```ts
export function sessionCookie(token: string, secure: boolean, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Strict",   // not sent on cross-site requests — CSRF protection
    secure ? "Secure" : "",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ].filter(Boolean).join("; ");
}
```

`SameSite=Strict` is the strictest setting: the browser withholds the cookie from
any cross-site request, including a top-level navigation (a plain link), not just
an XHR or a form POST. This has been true, and unit-tested, since Experiment 012 —
`session.test.mts` already asserts `secureCookie.includes("SameSite=Strict")` under
the label `"SameSite=Strict — CSRF defence"`.

**The one state-changing `PUT` — checked directly, not assumed.**

`PUT /api/login` (registration, `src/app/api/login/route.ts:78`) does not read the
session cookie at all:

```ts
const header = request.headers.get("authorization") ?? "";
const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
if (bearer !== secret) {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
```

It requires the operator credential (`APP_SECRET`) as an explicit `Authorization`
header — never ambient, never attached by a browser automatically. A forged
cross-site request cannot produce this header without already knowing the secret,
at which point CSRF is not the interesting part of that scenario.

**No CORS configuration exists anywhere to widen either of these.**

```bash
$ grep -rn "Access-Control\|cors" src/ next.config.ts
(no matches)
$ find . -maxdepth 2 -iname "middleware.ts"
(no matches)
```

Next.js Route Handlers do not send CORS headers by default, and nothing in this
project adds them. There is no path by which a credentialed cross-origin request
could be authorized here even if `SameSite` were weaker than it is.

## Decisions

**No CSRF token added.** The project's own stated engineering principle is
"understand each layer before introducing abstraction," and the specific guidance
in memory for this project is not to build for a problem code does not have. A
token mechanism would duplicate a defense that already exists, already covers the
one code path that matters, and is already regression-tested. Adding one would be
the "premature abstraction" this project has avoided everywhere else, not a fix.

**The Deferred bullet is closed, not softened.** It would have been easy to leave
it in place with a note ("lower priority — see 040"), but that misrepresents the
finding. The question the bullet asked — is this a real gap — has a definite
answer now: no.

## Not verified

**Legacy-browser fallback.** `SameSite` is ignored by browsers that predate it
(pre-2016; notably, older Safari had a since-fixed bug ignoring `Strict` on
initial navigations from a bookmark). A visitor on one of those browsers would
fall back to pre-`SameSite` behavior, where the cookie WOULD be sent cross-site.
Judged an acceptable, explicitly-accepted residual risk for a personal learning
project rather than something worth a token mechanism to cover — recorded here so
the limitation is stated, not silently assumed away.

**Session-cookie theft via a channel other than CSRF** (a stolen token replayed by
a non-browser client, or XSS reading a cookie `HttpOnly` should prevent) is a
different threat model, already addressed elsewhere (`HttpOnly`; `revocation.ts`'s
denylist for a token that must be invalidated). Out of scope for a CSRF token,
whose whole job is stopping a victim's OWN browser from being tricked into
attaching credentials it already holds legitimately.

## Status

| Piece | State |
| --- | --- |
| Every cookie-issuing path carries `SameSite=Strict` | ✅ Verified by source inspection — one function, one call site pattern, no second path |
| Regression coverage for that attribute | ✅ Already existed (`session.test.mts`, Experiment 012/015) — nothing new needed |
| The one state-changing `PUT` does not depend on the cookie | ✅ Verified by reading `login/route.ts` directly |
| No CORS configuration widens either | ✅ Verified — no matches in `src/`, `next.config.ts`, no `middleware.ts` |
| `pnpm check` | ✅ Unaffected — no production code changed |

## Next Step

No queued item. The remaining Deferred items are either blocked on the Anthropic
credential (generation-phase latency, the real cache-write minimum), deferred
until a real threshold is crossed (prompt/tool caching, summarisation), or
deliberately postponed pending a second server instance (log shipping, moving
rate-limiter state into the store). Headless-browser UI verification is the one
remaining item that is neither blocked nor threshold-gated — but it means adding
this project's first browser-automation dependency, a bigger-footprint call than
the last four experiments, worth raising with Isaac before picking a library
rather than deciding it alone.
