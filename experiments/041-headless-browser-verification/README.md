# Experiment 041 — A Real Browser, Not Just curl

## Objective

README's Deferred list, since Experiment 030: "Headless-browser verification for UI
changes — Experiment 030 could only check rendered markup via `curl`, not an actual
screenshot." Every UI-adjacent experiment since (030's shell, 038's `Reserved` tile,
039's index badge) was verified by grepping response text for expected strings — real
verification, but blind to anything that only exists once a browser actually renders
the page: whether a stylesheet loaded, whether an element the markup contains is
actually *visible*, whether the page threw a console error nobody was watching for.

Unlike Experiments 037–040, this one adds a real dependency — the project's first
browser-automation tool. Flagged explicitly at the end of 040 rather than decided
alone, given every experiment since 037 had landed at "no new runtime dependencies."

## What happened — the install itself was the first finding

`pnpm add -D playwright` (a devDependency — nothing about the shipped app touches a
browser at runtime) was the easy part. `npx playwright install chromium` was not:

```text
Error: ERROR: Playwright does not support chromium on mac13
```

This machine runs macOS 13.7.8 (Ventura). Reading `playwright-core`'s own platform
detection (`hostPlatform.ts`, bundled) found the actual rule:
`isOfficiallySupportedPlatform: macVersion >= 14` — Playwright's install step refuses
to even attempt a download for anything older than macOS 14, not because Chromium
cannot run there, but because it is outside their tested support window.

`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac14 npx playwright install chromium` downloads
the mac14 build instead and — checked directly, not assumed — it launches and renders
correctly on this mac13 host: `chromium.launch()` → `page.goto("data:text/html,<h1>hello</h1>")`
→ `page.textContent("h1")` returned `"hello"`. The override is an install-time-only
concern; nothing in `scripts/visual.mts` itself needs it, and `chromium.launch()` at
runtime works with no special environment.

## What We Built

| File | What it is |
| --- | --- |
| `package.json` | `playwright` devDependency; `pnpm visual` script. |
| `scripts/visual.mts` | Reuses `startServer()`/the e2e harness pattern — spawns a real server on its own throwaway database, then drives an actual headless Chromium against it. |
| `scripts/check.mts` | A 7th gate, `visual`, inserted after `eval` and before `verify` (cost order). `skipIf` checks `existsSync(chromium.executablePath())` — the exact shape `verify`'s credential check already uses — so a fresh clone without the browser installed SKIPS this gate rather than failing `pnpm check`, and CI (which has not installed it) is unaffected until someone decides to. |
| `.gitignore` | `/screenshots/` — regenerated every run, not committed. |

## What `pnpm visual` actually checks

Registration (`PUT /api/login`, operator-only, no UI of its own by design — see
Experiment 016) is a plain `fetch()`. Everything after that is driven through the
real browser, not shortcuts around it:

1. **The lock screen** — the username/password fields are asserted `isVisible()`
   (not just present in the DOM), and the submit button's *computed* background
   color is read via `getComputedStyle()` to prove the stylesheet actually loaded —
   something `curl` cannot distinguish from unstyled HTML.
2. **Signing in through the real form** — types into the actual inputs and clicks
   the actual button, rather than injecting a cookie the way `app-client.mts`'s
   `signIn()` does for the HTTP-only e2e suite. Caught one real bug in the check
   itself along the way (below).
3. **The authenticated shell** — the `Chat` and `Ask the notebook` headings, and the
   TopBar resolving and displaying `alice` — server-rendered from the session
   cookie (Experiment 016), not the client remembering who logged in.
4. **`/metrics`** — every one of the five budget tiles, including `Reserved`, the
   one Experiment 038 added and until now had only been confirmed by grepping HTML.
5. **Zero console or page errors** across the whole run — the specific class of bug
   a markup check cannot see by construction.

Three screenshots land in `screenshots/` (gitignored): the lock screen, the
authenticated home page, and `/metrics`. Looked at all three directly — the
`Reserved` tile renders exactly where and how it should, and the shell matches
Experiment 030's description of itself.

## Decisions

**`playwright`, not `playwright-core` + manual browser management, and Chromium
only.** `playwright` bundles the install CLI (`npx playwright install`), which is
simpler than driving `playwright-core`'s lower-level API by hand for a one-browser
use case. Chromium alone (not the three-browser default) is what "one real rendering
engine" actually requires — this project has never had cross-browser compatibility
as a goal, and the two extra browsers would roughly double the download for
coverage nobody asked for.

**A separate `pnpm visual`, not folded into the browser-driven part of `pnpm e2e`.**
`e2e.mts` never opens a browser — it drives the HTTP surface directly, which is
faster and is what most of its 37 assertions actually need to check. Bolting a
browser launch onto that file would have made every `pnpm e2e` run pay Chromium's
startup cost for the (small) minority of checks that need it. Two files, two costs,
matching how `pnpm eval` and `pnpm verify` are already separate from `pnpm test`.

**Wired into `pnpm check` as a skippable gate, not left as a manual-only script.**
The alternative — leaving `visual` out of `check.mts` entirely — would have meant
this check quietly bit-rots the moment nobody remembers to run it by hand, the
exact failure mode Experiment 022 built `pnpm check` to end. `skipIf` makes "not
installed" a stated skip, identical in shape to how `verify` handles a missing
credential, rather than a hard failure for anyone who has not run the one-time
`npx playwright install chromium`.

**Not added to CI (`check.yml`) yet.** Doing so needs `--with-deps` (system
libraries a GitHub Actions image does not have by default) and a real measurement
of how much it slows the workflow — a second, smaller decision, deliberately left
for its own pass rather than bundled into this one.

## Not verified

- **Whether `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` is needed on Isaac's actual
  machine.** This was diagnosed and fixed for THIS sandbox (macOS 13.7.8). A
  different host — including a newer macOS, or Linux CI — may not need the
  override at all, or may need a different one. Recorded in this README rather
  than silently baked into any script, since baking in a workaround for a
  problem a different host might not have would be exactly the kind of
  guessing this project avoids elsewhere.
- **CI.** `pnpm check` was run locally, not through GitHub Actions — the `visual`
  gate will simply skip there today (no chromium installed on the runner), which
  is the intended, tested behavior, not an oversight.

## Status

| Piece | State |
| --- | --- |
| `pnpm visual` — 12 assertions across the lock screen, sign-in, the authenticated shell, `/metrics`, and console errors | ✅ Verified — all pass, three screenshots inspected directly |
| `pnpm check` gates visual work correctly when chromium is present | ✅ Verified — ran locally, green |
| `pnpm check` skips cleanly when chromium is absent | ✅ Verified — re-ran with `PLAYWRIGHT_BROWSERS_PATH` pointed at an empty directory; gate reported `skipped`, not `failed` |
| CI wiring | ❌ Not done — see Decisions |

## Next Step

No queued item. This closes the last non-blocked, non-threshold-gated item on the
Deferred list. What remains is either blocked on the Anthropic credential
(generation-phase latency, the real cache-write minimum), deferred until a real
threshold is crossed (prompt/tool caching, summarisation), or deliberately postponed
pending a second server instance (log shipping, moving rate-limiter state into the
store) — plus the smaller CI-wiring thread this experiment left open.
