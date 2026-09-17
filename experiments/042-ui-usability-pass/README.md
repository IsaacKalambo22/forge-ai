# Experiment 042 — Three of Four

## Objective

Isaac's own read of the running app, not a code-review finding: "the ui is not
self explanatory and not convincing and not mobile responsive and also cannot
navigate." Four claims, asked to be fixed one by one. This experiment closes
three of them with real code; the fourth ("not convincing" — visual identity)
is deliberately left open, for the reason at the end.

## What happened — checking each claim before fixing it

**"Cannot navigate" turned out to be real and specific, not vague.** The top
nav (`Notebook` / `Observability`) worked fine — checked directly, no dead
links. What didn't exist: any way back to a PAST conversation. `chat.tsx` held
`conversationId` in `useReducer` state only. Refresh the tab and it is gone
from the screen — not from the server, `transcripts.listByOwner()` has existed
and stored every conversation since Experiment 016 — just gone from anything
the UI could reach. One conversation per page load, ever, was the actual
product this shipped.

**"Not mobile responsive" needed a real device check, not a guess.** Loaded
the actual running app in headless Chromium at a 375px viewport (`pnpm visual`'s
own infrastructure, reused for this diagnosis). No horizontal overflow — that
part was already fine. What wasn't: `Input`/`Select` rendered at `text-sm`
(14px), which is under the 16px threshold that makes iOS Safari zoom the
WHOLE PAGE in in on focus — nothing to do with intent, a pure font-size
trigger, and exactly the kind of thing that reads as "the site is broken" on
a phone rather than "the site zoomed." Measured `Send`, the nav links, and the
inputs at ~32-36px tall — under Apple's 44px minimum tap target.

**"Not self-explanatory" was concrete on the one screen that matters most.**
The lock screen showed "Forge AI" and a form. Nothing said what the product
does, and nothing told a visitor without an account what to do next —
registration is deliberately operator-gated (Experiment 016), which is the
right call for a service that spends money per request, but leaving a visitor
to guess why nothing happens is not the same decision as gating registration.

## What We Built

| Piece | What it is |
| --- | --- |
| `GET /api/conversations` | Lists the signed-in user's conversations (`transcripts.listByOwner`, already built, never exposed). Free (`COST.conversations = 0`), still behind `guard`. |
| `GET /api/conversations/[id]` | One conversation's persona + full transcript. Same authorized-404 shape as `/api/chat`/`/api/analyze` (Experiment 016) — `transcripts.readable()`, a stranger's id and a nonexistent one are indistinguishable. |
| `chat-state.ts` — `new_conversation` / `conversation_loaded` | Two new reducer actions, both unit-tested. `new_conversation` resets everything but the current persona (a real, separate intent from `persona_changed`'s reset, which is a side effect of switching personas). `conversation_loaded` hydrates from what the server actually has. |
| `chat.tsx` | A "Conversation" `<Select>` next to the existing "Persona" one — lists past conversations (persona + timestamp), refetched whenever the active conversation changes. Picking one fetches its transcript and restores it; "New conversation" resets. |
| `components/ui.tsx` — `Button`/`Input`/`Select` | `text-base sm:text-sm` (16px under the `sm:` breakpoint, 14px above it) and `min-h-11` (44px). One change, every usage across the app benefits — login, chat, ask, persona pickers. |
| `nav-links.tsx` | Same `min-h-11` treatment — the one link that gets a visitor anywhere at all. |
| `layout.tsx` / `login.tsx` | A one-line description of what the product is, and a line telling an account-less visitor what to actually do (ask the operator), instead of a bare form. |

## Verified live, against the real running app

`pnpm check`'s `e2e`/`visual` gates need to spawn their own server, and could
not while Isaac's own `pnpm dev` was already running against this project
(Next.js refuses a second dev server per directory, any port) — so this was
checked directly against THAT server, the one actually being looked at,
arguably more meaningful than a synthetic one:

```text
sent a message → conversation appeared in the switcher
reloaded the tab → conversation survived in the list, transcript did not
                    (expected — that IS the gap this closes)
selected it from the switcher → the old question reappeared on screen,
                                 restored from the server, not memory
```

```text
mobile viewport (375×667):
  chat input font-size: 16px     (was 14px — the iOS zoom trigger)
  Send button height:   44px     (was ~36px)
  nav link height:       44px     (was ~32px)
  horizontal scroll:     none, before and after
```

`types`, `lint`, and `test` (860 assertions, +6 for the two new reducer
actions) were run directly and are clean. `e2e`/`visual` were not re-run
through `pnpm check` for the reason above — queued rather than skipped
silently; see Not verified.

## Decisions

**A native `<select>`, not a custom dropdown/sidebar.** The simplest thing
that actually works on both desktop and mobile without a new dependency or
component — matches how the persona picker already works, right next to it.
A sidebar with previews is a real future upgrade, not required to fix
"cannot navigate."

**Refetch the conversation list on every `conversationId` change, not a
separate cache with its own invalidation.** One dependency, one effect,
always accurate — the list is a convenience view over data the server
already owns, not a second source of truth to keep in sync by hand.

**The mobile fix went into the shared components, not each screen.**
`Button`/`Input`/`Select` are used everywhere; fixing the font-size and
tap-target thresholds once there means every current and future screen
inherits it, rather than three screens getting the fix and a fourth being
forgotten.

**"Not convincing" is NOT addressed here.** Unlike the other three, it names
no reproducible defect — no broken link, no failing check, no measurable
threshold like 16px or 44px. It is almost certainly about visual identity:
flat monochrome surfaces, no accent color, no icons, wireframe-adjacent. That
is a real, legitimate piece of feedback, and also the one place in this batch
where guessing a direction (a color palette, a whole new visual language,
dark mode) risks building the wrong thing well rather than the right thing at
all. Flagged back to Isaac rather than decided alone — the other three had
objective, checkable answers; this one does not.

## Not verified

- **`pnpm check`'s `e2e` and `visual` gates**, specifically — blocked by a
  real environmental conflict (Isaac's own dev server holding the project's
  Next.js dev lock), not a defect in the code under test. The live
  verification above exercises the same paths by hand; queued to re-run
  through `pnpm check` once that server is free.
- **A real touchscreen device.** Chromium's mobile emulation (viewport +
  computed styles) is what caught the 14px/36px numbers; it does not fully
  reproduce Safari's actual zoom behavior or a finger's actual imprecision
  the way a physical phone would.

## Status

| Piece | State |
| --- | --- |
| Conversation history + switching | ✅ Verified live against the real running server (see above) |
| Mobile input zoom / touch targets | ✅ Verified live — 16px font, 44px targets, confirmed by computed style, not assumed from the Tailwind class name |
| Login screen context | ✅ Shipped; not yet screenshotted (blocked on `pnpm visual`, see Not verified) |
| `types` / `lint` / `test` | ✅ Clean — 860 assertions |
| `e2e` / `visual` through `pnpm check` | ⏳ Queued — environmental conflict, not a failure |
| Visual identity ("not convincing") | ❌ Deliberately not attempted — see Decisions |

## Next Step

Re-run `pnpm check` in full once a dev server isn't already holding the
project's lock. Then: visual identity — needs a direction from Isaac before
building anything, not a default I should pick.
