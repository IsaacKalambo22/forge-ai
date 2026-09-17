# Experiment 038 — Making the Display Agree With the Check

## Objective

Experiment 037 made `checkBudget()` — the function that actually authorizes or
refuses a request — count outstanding reservations alongside recorded spend, closing
the race where concurrent requests all read the same under-budget total. It
deliberately left `budgetStatus()` — the function `/metrics` reads, the number an
operator actually looks at — reporting recorded spend only, and said so in its own
README:

> `budgetStatus()` (surfaced on `/metrics`) still reports recorded spend only, not
> outstanding reservations... a display decision independent of the correctness fix.

That left a real gap: an operator could watch `/metrics` show `$4.97 remaining`, in a
window where `checkBudget()` would already refuse the next request because a claim it
can't see has eaten most of the headroom. The enforcement and the display disagreeing
is exactly the kind of thing this project's `/metrics` page exists to prevent — it was
built in Experiment 030/033 specifically to render "no fabricated numbers."

## What We Built

`budgetStatus()` (`src/lib/guard.ts`) now reads `reservations.activeTotal()` the same
way `checkBudget()` does, and returns it as its own field rather than folding it into
`spent_today`:

```text
spent_today   recorded billing history — usage.spentTotal()
reserved      outstanding claims, usually gone within seconds — NEW
remaining     daily_budget − spent_today − reserved            — now agrees with
                                                                   what checkBudget()
                                                                   actually authorizes
```

`src/app/metrics/page.tsx` gained a fifth stat tile ("Reserved") in the Budget
section, and the grid went from 4 to 5 columns to keep it a single row on desktop.

## Verified live

Started the dev server and drove the real path, not just the unit tests:

```text
before an /api/ask call:  reserved $0,     remaining $5.0000
mid-flight (in progress): reserved $0.0256, remaining $4.9744
after it completes:       reserved $0,     remaining $5.0000
```

(The call itself 401'd — `invalid x-api-key`, the placeholder credential — which is
expected and irrelevant here: `guard()` stakes the claim regardless of what the
upstream call does, and the route's `finally` releases it regardless of how that call
ends. The `/metrics` page's HTML was also checked directly — the "Reserved" tile
renders.)

## Decisions

**A separate field, not folded into `spent_today`.** They mean different things —
one is permanent ledger history, the other is temporary working state — and 037's own
README made the case for keeping reservations out of the permanent ledger's tables.
Keeping them visually separate on `/metrics` is the same reasoning applied to the
display.

**Five columns, not four with a dropped field.** The alternative — silently making
`remaining` reservation-aware without exposing why it moved — would have fixed the
correctness gap while re-introducing a smaller version of the same problem: a number
changing for a reason the operator can't see on the page.

## Status

| Piece | State |
| --- | --- |
| `budgetStatus()` returns `reserved`, and `remaining` subtracts it | ✅ Verified (unit + live) |
| `/metrics` page renders a fifth "Reserved" tile | ✅ Verified live (HTML checked directly) |
| `pnpm check` (types · lint · unit · e2e · eval) | ✅ All gates pass — 854 assertions (was 849) |

## Next Step

No queued item. This closes the one thread 037 deliberately left open; the
generation-phase latency gap and the `indexBuilt` cross-layer split are unchanged.
