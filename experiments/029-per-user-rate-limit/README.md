# Experiment 029 — Per-User Rate Limiting

## Objective

The README's Deferred list has carried this since Experiment 016 added identity:

> Per-user rate limiting — the limiter runs before identity is known

Read `guard()` before assuming that was still true. It wasn't, not exactly — and the
real shape of the gap is more specific than the one-liner.

## What happened

`guard()` in `src/lib/guard.ts` already calls `checkAuth()` before `rateLimit()`:

```ts
export function guard(request: Request, route: RouteName): Response | Identity {
  const auth = checkAuth(request);
  if (auth instanceof Response) return auth;

  const limited = rateLimit(request, route);   // auth.userId exists here, unused
  ...
```

Identity is not unknown at that point — it is known and thrown away. `callerKey()`
reads `x-forwarded-for` unconditionally and never looks at `auth`. The deferred note
described the wrong mechanism (an ordering problem) for a real gap (an unused value).
Distinguishing the two mattered: the fix that "orders identity before the limiter"
would have been a no-op, since that ordering already existed.

The actual consequence, concretely:

- Two different signed-in users behind one IP (a shared office network, a campus, a
  corporate NAT) shared one 20-token bucket. One heavy user starves the other.
- One user opening multiple sessions from different networks got a fresh 20-token
  bucket per IP — the limiter's per-caller ceiling meant nothing to them.

`login`/`register` are the one place this ordering genuinely doesn't apply — they call
`rateLimit()` directly, before any session exists, because a password-guessing attempt
has no user id to be limited *by*, only one to guess against. That path had to keep
its IP key exactly as it was.

## What We Built

| Piece | What it is |
| --- | --- |
| `callerKey(request, userId?)` | Keys on `user:<id>` when known, falls back to `ip:<addr>` — prefixed so the two spaces can never collide |
| `rateLimit(request, route, userId?)` | Takes the optional id; `guard()` passes `auth.userId` once it has one |
| `tests/rate-limit-identity.test.mts` | 64 assertions: two users sharing an IP get separate buckets; one user rotating IPs gets one bucket; the no-identity path still falls back to IP |

`login`/`register`'s two direct `rateLimit()` calls are unchanged — no third argument,
same IP-keyed behaviour as before.

## Decisions

**Prefix the key (`user:`/`ip:`), not a bare id.** A user id and an IP address are
different alphabets that happen to both be strings; an attacker-chosen username equal
to some caller's IP address would otherwise collide two callers into one bucket.
Cheap insurance for one line.

**`login`/`register` keep IP keying, deliberately.** They are the routes an attacker
without any valid identity hits hardest. Per-user keying only bounds people the system
can already name — it has nothing to say about someone still guessing who to be.

**No change to the shared-store deferral.** `README.md`'s next line — moving the
limiter and telemetry into a store so it survives a restart and is shared across
instances — is a different problem (durability and multi-instance) from this one
(which identity keys the bucket). Fixing the key does not fix the single-process
limitation; it stays deferred, unchanged.

## Questions

- **Multiple browser tabs/devices for one user now share one bucket**, where they
  used to (accidentally) get separate ones if on different networks. That's the
  intended effect of "per-user," but worth naming: a legitimately busy user with three
  tabs open now competes with themself for the same 20 tokens.
- **Still single-process.** A determined attacker spread across many processes (a
  scaled deployment) is unaffected by this fix — that is the shared-store deferral,
  not this one.

## Status

| Piece | State |
| --- | --- |
| `callerKey()` keys on user id when known | ✅ Verified |
| `login`/`register` unchanged (still IP-keyed) | ✅ Verified |
| Two users, one IP → independent buckets | ✅ Verified (unit test) |
| One user, many IPs → one bucket | ✅ Verified (unit test) |
| `pnpm check` | ✅ All gates pass |

## Next Step

Unlike 027 and 028, this one needed no push and no credential to confirm — the fix and
its verification both live entirely in the process. Whatever comes next from here
(the API credential, tracing, or the shared-store deferral this experiment
deliberately left alone) is a real choice, not a forced one.
