# Experiment 016 — Identity and Authorization

## Objective

Experiment 015 made conversations durable and left them **unowned**.

The project could answer *is this a valid session?* and could not answer *is this
conversation yours?* — a gap with no consequences when every conversation died with
the tab, and real consequences the moment they persisted to disk.

It also retires the note Experiment 012 left behind: *"One password, no users.
Multi-user identity is a different problem."* This is that problem.

> **Authentication** is *who are you*. **Authorization** is *may you touch this*.
> Having the first is not having the second, and 015 shipped with exactly that gap.

## What We Built

| File | What it is |
| --- | --- |
| `src/lib/users.ts` | Users, scrypt password hashing, timing-equalised authentication |
| `db.ts` migration 3 | `users` table; `conversations.owner_id` |
| `session.ts` | Payload gains `sub` — sessions now say **who** |
| `guard.ts` | Returns an `Identity`, not `null` |
| `transcripts.ts` | `readable()` — the authorization check; `listByOwner()` |
| `/api/login` | `POST` username+password · `PUT` register · `DELETE` logout |

Test suite: **315 → 364 assertions.** New runtime dependencies: **none.**

## Architecture

```text
POST /api/chat  { conversation_id, message }
   │
   ▼
guard() ──→ Identity { userId }         ← 016: was Response | null
   │
   ├─ session cookie → verify MAC → payload.sub      ← the identity
   │                 → revocation denylist (015)
   │
   ▼
transcripts.readable(conversationId, userId)
   │
   ├─ does not exist   → null
   ├─ owned by someone else → null      ← INDISTINGUISHABLE, deliberately
   └─ yours            → Conversation
            │
            ▼  404 for both nulls, never 403
```

`APP_SECRET` changed role. It used to **be** the password; it is now the key that
signs sessions and the credential that authorizes registration — an operator secret,
not a user one.

## Key Concepts

**Authentication vs. authorization.** Distinct questions, and the second needs the
first to have produced a *name*. Before 016 `guard()` returned `Response | null` —
allowed or denied, with nobody allowed. It now returns an `Identity`, because a route
that cannot name the caller cannot check whether a conversation is theirs.

**Subject (`sub`).** The user id inside the session token. Safe in a signed-but-not-
encrypted token: it is opaque, it is not a secret, and the holder already knows who
they are. What they cannot do is *change* it, because they cannot produce the MAC.

**Password hashing is the opposite problem to token hashing.** `revocation.ts` hashes
session tokens with plain SHA-256 and that is correct there — the input is 256+ bits
of MAC output, so there is no dictionary to attack and no reason to pay for slowness.
A password is short, human-chosen, and drawn from an enumerable space. Against a
leaked table, **SHA-256's speed is the vulnerability**: billions of guesses per second
on a GPU. A password hash must be deliberately slow and memory-hard.

**Salt.** Random per password, stored beside the hash. Without it, two users with the
same password share a digest, and one precomputed table attacks every row at once.

**Storing the cost parameters with the hash.** `scrypt$16384$8$1$salt$digest`. Without
them, raising the cost later would make every existing password unverifiable — the
stored digest is the output of a function you can no longer name.

**Timing oracle.** If an unknown username returns in microseconds and a wrong password
takes 80ms, response time tells an attacker which usernames exist. Enumerating
accounts is the first step of attacking them, so the unknown-username path pays for a
scrypt call against a dummy hash.

**404 over 403.** A 403 means *this exists, but not for you* — which confirms the id is
real. That confirmation is the one thing an attacker holding a leaked id could not
otherwise derive.

## Implementation

**`owner_id` is NULLABLE, and that is a decision.** Adding a `NOT NULL` column to a
populated table forces you to say what the *existing* rows mean, and the only truthful
answer was "nobody knows" — those conversations predate the concept of an owner.
Inventing one would be fabricating a fact. They are left NULL, and `readable()` treats
NULL as *not yours*, so they became **unreachable rather than misattributed**.

**Local development acts as a real user, not as nobody.** Without `APP_SECRET` the
project has always been open locally so `curl` works with no ceremony. Once every
conversation is owned, "open" becomes incoherent — an unowned request cannot own
anything. So there is a fixed `local-dev` user with a deliberately unusable password
hash (a random value nobody holds). In production an unset `APP_SECRET` already fails
closed with a 503 (Experiment 011), so it is unreachable there.

**Registration is gated by `APP_SECRET`, not open.** An open registration endpoint on
a service that spends money per request is an invitation. Requiring the operator
credential makes it an invite: whoever runs the server creates the accounts. It is the
simplest gate that is not "anyone", and it needs no email flow — which is an
experiment of its own.

**One error message for "no such user" and "wrong password".** Distinguishing them
hands over which usernames exist. The timing equalisation above is what stops the
response time giving away what the message conceals.

## Testing

```bash
pnpm test                                  # 364 assertions
APP_SECRET=… pnpm dev                      # then real HTTP, below
```

## Observations

### Observed — registration is gated

```text
PUT /api/login  (with operator credential)
  {"ok":true,"id":"c4d72776-…","username":"alice"}
  {"ok":true,"id":"1742fdd6-…","username":"bob"}

PUT /api/login  (without)
  {"error":"Unauthorized"} [HTTP 401]
```

### Observed — login does not reveal which usernames exist

```text
wrong password       {"error":"Incorrect username or password"} [HTTP 401]
nonexistent user     {"error":"Incorrect username or password"} [HTTP 401]
```

Byte-identical. And the timing is equalised — measured in the unit tests at
`unknown 56ms vs wrong-password 54ms`, because the unknown-user path still pays for a
scrypt call.

### Observed — THE 016 FIX: cross-user access is indistinguishable from nonexistent

Alice creates a conversation. Bob, a legitimately signed-in user, tries it:

```text
1. ALICE reads her own conversation                       [HTTP 200]
2. BOB tries the same id        {"error":"Unknown conversation"} [HTTP 404]
3. BOB tries an id that does not exist at all
                                {"error":"Unknown conversation"} [HTTP 404]
4. BOB tries to ANALYSE it      {"error":"Unknown conversation"} [HTTP 404]
```

**Responses 2 and 3 are byte-identical.** To Bob, Alice's real conversation and an id
that was never created are the same thing. A 403 on line 2 would have told him the id
was real — the single fact he could not otherwise obtain.

Line 4 matters separately: analysing someone else's conversation is *reading* it with
an extra step, so `/api/analyze` needed the same check. A permission enforced on one
route and not its neighbour is not enforced.

### Observed — a rejected request leaves no trace

After Bob's three failed attempts, Alice's transcript:

```text
conversations:
  bd741359-…  persona=terse  owner=alice

all turns:
  [0] user: my private question
  [1] user: follow up
```

Bob's `"let me see that"` is absent. The authorization check runs **before** the
write, so a denied request cannot append to a conversation it is not allowed to read.
Checking after the write would have let a stranger graffiti a transcript they could
not see.

### Observed — passwords are salted and parameterised on disk

```text
alice   scrypt$16384$8$1$17c2bb9...
bob     scrypt$16384$8$1$0d5f6b5...
```

Different salts, cost parameters recorded inline. A single verification measured at
**66ms** — the slowness is the feature.

### Observed — local development is unchanged, and the dev account is unusable

Without `APP_SECRET`:

```text
curl -X POST /api/chat -d '{"message":"does dev mode still work?"}'
{"type":"conversation","id":"4755cac9-…"}

conversations:  4755cac9-…  persona=default  owner=local-dev
```

With `APP_SECRET` set, every attempt to log in *as* `local-dev` fails:

```text
password="local-dev"                             401
password=""                                      401
password="password"                              401
password="00000000-0000-0000-0000-000000000000"  401
password="operator-secret"                       401
```

And the old shared-password login is gone: `{"password":"operator-secret"}` with no
username now returns 401.

## Mistakes / Failures

**I wrote authorization tests that the database refused to let me set up.**

The first version of the ownership tests used made-up uuids as owners:

```ts
const ALICE = "11111111-1111-1111-1111-111111111111";
createConversation(d, "engineer", ALICE, T);
```

Every insert failed:

```text
Error: FOREIGN KEY constraint failed
```

*What I expected.* To assert ownership with two arbitrary id strings — I was thinking
of `owner_id` as a label, not as a reference.

*Why it happened.* Migration 3 declares
`owner_id TEXT REFERENCES users(id)`, and Experiment 015 turned on
`PRAGMA foreign_keys = ON`. A conversation cannot be owned by a user who does not
exist, and the database enforced that against *me*.

*How it was fixed.* The test fixture creates real users, and `readable()` is tested
against ids the database issued.

*What it taught me.* This is the constraint-in-the-schema argument arriving from the
other direction. In 015 I wrote that constraints "hold when the code above them is
wrong" as a general principle; here the code above them was my own test, and being
stopped was the correct outcome. **A constraint that only ever inconveniences other
people is one you have not really tested.**

## Decisions

**Registration gated by `APP_SECRET` rather than open or seeded.** Open invites abuse
on a metered service; a seed script means credentials in a file. This reuses a secret
that already exists and already fails closed in production.

**No roles, no permissions table.** There is one kind of user and one kind of
resource. A `permissions` table here would be architecture ahead of need — the
project rule. `owner_id` answers every question currently being asked.

**No password reset, no email.** Both need an email pipeline, which is a genuinely
separate experiment. An operator can create a replacement account today.

**`sub` in the token rather than a session row.** Keeps verification stateless, which
is the property 012 chose deliberately and 015 preserved with a denylist rather than
discarding.

**A token minted before 016 is rejected, not defaulted.** It verifies and carries no
subject. Treating that as "some default user" would be inventing an identity; a
session that cannot say who it is has no business authorizing anything.

## Questions

- **`APP_SECRET` as a Bearer token still authenticates, as the `local-dev` user.**
  It is an operator credential that names nobody, so it is mapped to the dev identity
  rather than being refused. That is defensible for scripts and `curl`, and it does
  mean one credential can read the dev user's conversations. *Worth revisiting when
  there are service accounts.*
- **No CSRF token**, still. `SameSite=Strict` covers the browser cases that matter
  here, and now there is a state-changing `PUT`. *Deferred, and slightly more
  pressing than it was.*
- **Rate limiting is per-IP, not per-user.** One account behind many addresses is
  still cheap to abuse, and the limiter cannot see identity because it runs before
  `checkAuth` returns one. *Deferred — it needs the shared store 015 also deferred.*
- **Login attempts are not logged as such.** 014 gives structured logs and a failed
  login is just another 401 in them. Distinguishing repeated failures per username is
  the first thing an intrusion would show up in. *Deferred.*
- **No account deletion, and conversations cascade from users only by convention.**
  Deleting a user would orphan their conversations exactly like the pre-016 rows.
- **Nothing here has been observed under a successful model call.** Unchanged and
  still **blocked** on the credential.

## Status

| Piece | State |
| --- | --- |
| `users.ts` — hashing, salting, timing | ✅ Verified, 49 assertions |
| Migration 3 against a populated database | ✅ Verified — data survived the ALTER |
| Sessions carry `sub` | ✅ Verified |
| **Cross-user access denied, 404 not 403** | ✅ **Verified over real HTTP** |
| **A denied request writes nothing** | ✅ **Verified — transcript unchanged** |
| Registration gated | ✅ Verified |
| Local dev unchanged; dev account unusable | ✅ Verified |
| Per-user rate limiting | ⬜ Deferred |
| CSRF token | ⬜ Deferred |
| An assistant turn from a real model | ⛔ Blocked — no API credential |

## Next Step

**Experiment 017 — Cost and Token Accounting.**

Three experiments have now deferred the same item for the same reason. 014 wanted
token counts per request and had no `usage` object to record. 011 caps spending by
counting *requests*, which is a proxy: one request can be six upstream calls and a
long context can cost many times a short one. 015 built a place to put durable facts
and did not put any billing facts in it.

The design work — a `usage` table keyed by user and conversation, cost derived from
per-model token pricing, the guard consulting spend rather than request count — is all
possible now, and most of it is testable with recorded fixtures. Only the final
number needs a real API credential, which makes it the honest next step: build the
accounting, verify the arithmetic, and leave one clearly-marked gap.
