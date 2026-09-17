// Experiment 041 — `pnpm visual`. Headless-browser verification for UI changes.
//
// README's Deferred list named this since Experiment 030: "Experiment 030 could
// only check rendered markup via curl, not an actual screenshot." curl sees
// bytes. It cannot say whether a stylesheet actually loaded, whether an element
// a screen reader or a real visitor would see is actually VISIBLE (as opposed
// to present in the markup but hidden), or whether the browser's own console
// logged an error nobody would otherwise notice.
//
// This is the project's first browser-automation dependency: `playwright`, a
// devDependency only — nothing about the shipped app depends on a browser at
// runtime, so the "one runtime dependency this project did not write"
// (node:sqlite) count is unaffected. Chromium only, not the full three-browser
// install: one real rendering engine is what this needs, not cross-browser
// compatibility testing nobody asked for.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";

import { startServer } from "./app-client.mts";
import { group, ok, report, exitCode } from "../tests/harness.mts";

const SCREENSHOT_DIR = "screenshots";
mkdirSync(SCREENSHOT_DIR, { recursive: true });

console.log("forge-ai — visual\n  starting a server on its own database…");
const server = await startServer();

/**
 * Registration is an operator action (Experiment 016), gated by APP_SECRET —
 * there is no registration FORM in this app, by design, so there is nothing
 * for a browser to drive here. Signing IN is what a real visitor does, and
 * that is the part driven through the actual browser below, not this fetch.
 */
async function register(username: string, password: string): Promise<void> {
  const response = await fetch(`${server.url}/api/login`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${server.secret}` },
    body: JSON.stringify({ username, password }),
  });
  if (response.status !== 201) {
    throw new Error(`register ${username} failed: ${response.status} ${await response.text()}`);
  }
}

const browser = await chromium.launch();

try {
  await register("alice", "a-visual-test-password");

  const page = await browser.newPage();

  // Console errors and uncaught exceptions are invisible to curl and to a
  // markup-only check — this is specifically the class of bug a screenshot
  // check exists to catch.
  const consoleErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  group("visual — the lock screen (Experiment 011/016)");
  await page.goto(server.url);
  const usernameField = page.getByPlaceholder("Username");
  const passwordField = page.getByPlaceholder("Password");
  ok("the username field is actually visible, not just present in the markup",
    await usernameField.isVisible());
  ok("the password field is actually visible", await passwordField.isVisible());

  const submit = page.getByRole("button", { name: "Sign in" });
  const buttonColor = await submit.evaluate((el) => getComputedStyle(el).backgroundColor);
  ok("the submit button has a real computed background — the stylesheet loaded; " +
    "this is not unstyled HTML", buttonColor !== "rgba(0, 0, 0, 0)" && buttonColor !== "",
    buttonColor);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-login.png` });

  group("visual — the theme toggle (Experiment 043), reachable even signed out");
  const themeSelect = page.getByLabel("Theme");
  const bgBeforeToggle = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await themeSelect.selectOption("dark");
  await page.waitForTimeout(200); // the 150ms background-color transition in globals.css
  const bgAfterDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok("selecting Dark actually changes the rendered background — not just a class name",
    bgAfterDark !== bgBeforeToggle, `${bgBeforeToggle} -> ${bgAfterDark}`);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01b-login-dark.png` });

  await page.reload();
  await page.waitForLoadState("networkidle");
  const bgAfterReload = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok("the choice survives a reload — layout.tsx's pre-hydration script reapplies it " +
    "before paint, not after", bgAfterReload === bgAfterDark, `${bgAfterReload} vs ${bgAfterDark}`);

  // Back to light for the rest of this run's screenshots — an explicit reset,
  // not a side effect the reader has to notice was never undone.
  await page.getByLabel("Theme").selectOption("light");
  await page.waitForTimeout(200);

  group("visual — signing in through the real form, not a cookie the test injected");
  await usernameField.fill("alice");
  await passwordField.fill("a-visual-test-password");
  await submit.click();
  // login.tsx does `window.location.reload()` on success (Experiment 001/002:
  // the browser holds a signed claim, never the secret) — a real navigation,
  // not a client-side route change. The URL is unchanged by that reload (same
  // path, before vs. after), so waiting on it would resolve immediately
  // against the PRE-reload page rather than the post-login one; waiting for
  // the element the reload is supposed to produce is what actually proves it
  // landed.
  const topBarUsername = page.getByText("alice", { exact: true });
  await topBarUsername.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  ok("the TopBar resolves and shows the signed-in username — server-rendered "
    + "from the session cookie, not something the client remembered",
    await topBarUsername.isVisible());

  group("visual — the authenticated shell (Experiment 030)");
  ok("the Chat heading renders", await page.getByRole("heading", { name: "Chat" }).isVisible());
  ok("the Ask heading renders",
    await page.getByRole("heading", { name: "Ask the notebook" }).isVisible());
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-home.png`, fullPage: true });

  group("visual — the top bar collapses into a menu below 640px (Experiment 044)");
  // Adding the theme toggle (Experiment 043) was what pushed the top bar past
  // its available width below `sm:` — measured, at the time, 440px of content
  // trying to fit in a 375px viewport, with the theme <select> clipped off the
  // right edge entirely. This is the regression test for that.
  await page.setViewportSize({ width: 375, height: 700 });
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  ok("no horizontal overflow at 375px", overflow.scrollWidth === overflow.clientWidth,
    `scrollWidth ${overflow.scrollWidth} vs clientWidth ${overflow.clientWidth}`);

  const menuButton = page.getByRole("button", { name: "Open menu" });
  ok("the menu button is visible below the breakpoint", await menuButton.isVisible());
  ok("the theme select is NOT reachable before the menu is opened",
    !(await page.getByLabel("Theme").isVisible()));

  await menuButton.click();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02b-mobile-menu.png` });
  ok("Observability becomes reachable once the menu is opened",
    await page.getByRole("link", { name: "Observability" }).isVisible());
  ok("the theme select becomes reachable too — the SAME element, not a second copy",
    await page.getByLabel("Theme").isVisible());

  await page.getByRole("button", { name: "Close menu" }).click();
  await page.setViewportSize({ width: 1280, height: 800 }); // back to default for what follows

  group("visual — /metrics, including the Reserved tile Experiment 038 added");
  await page.goto(`${server.url}/metrics`);
  for (const label of ["Spent today", "Reserved", "Remaining", "Daily budget", "Per-user budget"]) {
    ok(`"${label}" tile is visible`, await page.getByText(label, { exact: true }).isVisible());
  }
  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-metrics.png`, fullPage: true });

  group("visual — no console errors anywhere in this run");
  ok("zero console/page errors across login, sign-in, home and metrics",
    consoleErrors.length === 0, consoleErrors.join(" | "));
} finally {
  await browser.close();
  server.stop();
}

report();
process.exit(exitCode());
