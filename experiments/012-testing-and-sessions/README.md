# Experiment 012 — A Test Suite, and Session Authentication

## Objective

Close the two remaining structural gaps: code that could not be tested, and a UI that
could not authenticate.

## Part 1 — Making `server-only` modules testable

### The problem, three experiments old

Experiments 006, 009 and 010 each recorded `executeTool()` as untested. `tools.ts` is
marked `server-only`, and that marker exists precisely to make a non-server import fail:

```text
Error: This module cannot be imported from a Client Component module.
```

A plain Node test is not a Client Component, but Node has no way to say so — and every
test written since Experiment 006 lived as a throwaway file in a temp directory,
deleted after one run. The project had 100+ assertions and no way to re-run any of them.

### Finding: `server-only` is a two-line package

Reading it instead of working around it:

```json
"exports": { ".": { "react-server": "./empty.js", "default": "./index.js" } }
```

`index.js` throws. `empty.js` is empty. The only difference is the **export condition**.
So `node --conditions=react-server` makes the marker resolve to nothing, and the module
imports normally. No stub, no mock, no build step.

Two further gaps between what Next accepts and what Node accepts:

| specifier | Next | Node ESM |
| --- | --- | --- |
| `@/lib/tools` | tsconfig path alias | unknown |
| `./expression` | bundler resolution | needs an extension |

Both are closed by a ~30-line resolver in `tests/resolver.mjs` using
`node:module`'s `registerHooks`. Combined:

```bash
node --conditions=react-server --import ./tests/resolver.mjs tests/run.mts
```

Every module in `src/` is now importable by a test, including the ones that were
unreachable, and Node's native type stripping means there is no compile step.

### The suite

No test framework. Node already ships a module loader, assertions and an exit code;
`tests/harness.mts` is 40 lines and supplies the rest. This project has one dependency it
did not choose deliberately, and that is one too many.

```text
pnpm test  →  160 passed, 0 failed
```

| file | covers | from |
| --- | --- | --- |
| `expression.test.mts` | arithmetic, malformed input, 8 code-execution payloads | 006 |
| `tools.test.mts` | **`executeTool()`** — argument validation, caps, unknown tools | **006, 009, 010 (was blocked)** |
| `vector.test.mts` | cosine similarity, topK | 007 |
| `chunk.test.mts` | heading trails, code fences, sizing, the real notebook | 008 |
| `agent.test.mts` | stopping policy, loop detection, budget priority | 009 |
| `passage.test.mts` | V1 vulnerable, V2 hardened, nonce, fidelity | 010 |
| `ratelimit.test.mts` | spending, refill, weighting, eviction, clock defences | 011 |
| `stream.test.mts` | NDJSON reassembly + naive-reader negative control | 004 |
| `session.test.mts` | signing, expiry, forgery, cookie attributes | this experiment |

### What testing `executeTool()` actually found

Nothing broken — but the contract is now *verified* rather than asserted:

- an unknown tool returns an **error result**, not a throw, and names the tool so the
  model can recover;
- `null` input does not crash;
- a non-string or missing `expression` is rejected;
- the 200-character cap fires;
- `1/0` is reported as an error rather than returning `Infinity`;
- every tool description says *when* to call it, not just what it does — the Experiment 006
  lesson, now enforced by a test rather than remembered.

`passage.test.mts` keeps the **vulnerable V1 renderer** and asserts that it *is*
exploitable. A regression witness: if someone reintroduces that pattern, the test that
proves it dangerous is still there.

## Part 2 — Session authentication

### The problem

Experiment 011 shipped `APP_SECRET` + `Bearer` auth and immediately found its limit: **a
shared secret cannot authenticate a browser**, because the browser would have to hold it,
and anything the browser holds the user can read. With `APP_SECRET` set, the UI stopped
working.

### A signed claim instead of a secret

The browser gets a **session token** — a signed statement the server can verify and the
holder cannot forge:

```text
base64url({"iat":…,"exp":…}) . base64url(HMAC-SHA256(payload, secret))
```

Signed, **not encrypted**. The payload is readable by the holder and that is fine: it
contains no secret, only a claim. What the holder cannot do is change it.

Verification checks the **signature before parsing the payload**. Parsing
attacker-authored JSON to decide whether to check the signature is how JWT's `alg: none`
happened; doing the MAC first makes that shape impossible.

### The cookie attributes are the security

```text
HttpOnly       JavaScript cannot read it — an XSS bug cannot steal the session
SameSite=Strict  not sent cross-site — CSRF defence
Secure         HTTPS only (omitted on localhost, which has no HTTPS)
Path=/         reaches the API routes, not just the page
Max-Age        12 hours
```

The token being unforgeable matters less than the cookie being unreadable and
unsendable-cross-site. A perfect token in a readable cookie is a worse system than an
ordinary token in a properly attributed one.

### Verified: 33 session assertions

```text
issue/verify    fresh token verifies · payload carries iat/exp · base64url only (cookie-safe)
expiry          valid 1ms before exp · expired exactly at exp · short TTL expires
forgery         wrong key rejected · payload IS readable (signed, not encrypted)
                extending exp invalidates the signature
                empty MAC rejected · missing MAC section rejected
malformed       "" · "." · ".." · "a.b.c" · "!!!.???" · "a." · ".b" · "null" · "{}" — none throw
cookie          HttpOnly · SameSite=Strict · Secure · Path=/ · Secure omitted on localhost
                Max-Age=0 on clear
parsing         finds ours among others · null when absent · tolerates whitespace
                does NOT match a name merely ending with ours
```

That last one is the kind of bug a hand-rolled cookie parser ships with: a naive
`includes()` would match `not_forge_session=` and hand an attacker a session.

### Verified: the whole flow, end to end

Server run with `APP_SECRET="hunter2-correct-horse"`:

| step | result |
| --- | --- |
| page with no session | renders the login form, not the app |
| `/api/search` with no session | 401 |
| wrong password | 401 `Incorrect password` |
| correct password | 200 + `Set-Cookie: forge_session=…; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` |
| `/api/search` with the cookie | 200 |
| page with the cookie | renders the app |
| **payload rewritten, old MAC** | **401** |
| MAC removed | 401 |
| random garbage / empty | 401 |
| `Bearer` token (scripts) | 200 — still works |
| `DELETE /api/login` | `Set-Cookie: forge_session=; …; Max-Age=0` |

`Secure` is correctly **absent** in development, because localhost has no HTTPS and a
`Secure` cookie would simply never be sent.

### Finding: I wrote a comment that was not true

The first version of the login route carried a comment saying it was rate-limited. It was
not — `guard()` does the auth check first, so a login endpoint cannot use it, and I had
left the limiter out entirely.

An unlimited login endpoint is an offer to brute-force the secret. Fixed by splitting
`rateLimit()` out of `guard()` so login can have a limit without an auth check:

```text
401 ×20, then 429 429 429 429
```

Worth recording as a mistake rather than quietly fixing: **the comment was written
describing the intent, and the intent was never implemented.** A comment is not a test.
Everything else in this experiment is verified by something that runs.

### Verified: nothing regressed

| Check | Result |
| --- | --- |
| dev with no `APP_SECRET` | no login form; all routes 200 — unchanged |
| `next build` | clean |
| `pnpm test` | 160 passed, 0 failed |
| `APP_SECRET`, the password, `issueSession`, `createHmac`, `timingSafeEqual`, `forge_session` in browser | **0 hits each** |
| bundle | 3,782,899 bytes (+8,580 = the login form) |

The signing key, the signing code and the cookie name all stayed on the server. The
browser holds one thing: a cookie it cannot read.

## Lessons

1. **Read the package before working around it.** `server-only` is two files and an export
   condition; `--conditions=react-server` was the whole fix for a three-experiment blockage.
2. A resolver hook (`node:module` `registerHooks`) closes the gap between bundler-style
   imports and Node ESM in ~30 lines. Path aliases and extensionless imports both.
3. **Tests that live in a temp directory are not tests.** 100+ assertions existed and none
   could be re-run. Moving them into the repo was the larger win.
4. A test harness can be 40 lines. Node ships the loader, the assertions and the exit code.
5. **Keep a regression witness.** `passage.test.mts` asserts that the *vulnerable* renderer
   is exploitable, so reintroducing the pattern fails a test.
6. Encode invariants you want to keep: "every tool description says when to call it" is now
   a test, not a memory.
7. **A signed token is not an encrypted one.** The holder may read the payload; they may
   not change it. Do not put secrets in it.
8. **Verify the signature before parsing the payload.** Parsing attacker-authored JSON to
   decide whether to verify is how `alg: none` happens.
9. **The cookie attributes are the security.** `HttpOnly` beats XSS, `SameSite` beats CSRF.
   A perfect token in a careless cookie is the worse system.
10. Omit `Secure` on localhost or the cookie is never sent — and the failure looks like
    broken auth rather than a missing attribute.
11. Match cookie names exactly. `not_forge_session` must not match `forge_session`.
12. **A login endpoint cannot use the guard that requires login** — it needs the rate limit
    without the auth check, or it is a brute-force oracle.
13. **A comment is not a test.** Mine claimed a rate limit that did not exist.

## Future questions

- Sessions cannot be revoked before expiry — there is no server-side session list, so
  logout only clears the client's cookie. A stolen token stays valid for up to 12 hours.
  *Deferred: it needs the same shared store as the rate limiter.*
- One password, no users. Multi-user identity is a different problem.
- No CSRF token. `SameSite=Strict` covers the browser cases that matter here; a token is
  the belt to that braces. *Deferred.*
- The test suite has no coverage measurement, and the route handlers themselves are still
  only tested through HTTP by hand. *Deferred.*
- `tests/` runs everything in one process, so a module-level cache in one file could leak
  into another. Not yet true of anything here. *Watch it.*
