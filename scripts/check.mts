// Experiment 022 — `pnpm check`. The gate.
//
// The project accumulated four commands that verify different things and
// nothing that ran any of them. Every one depended on a person remembering,
// which is the failure mode behind the comment claiming a rate limit that did
// not exist (012), the README that contradicted itself for twelve experiments
// (013), and the e2e suite that leaked a server process while reporting success
// (021).
//
// This runs them in one command, in cost order, and stops at the first failure.
import { spawnSync } from "node:child_process";

type Gate = {
  name: string;
  command: string;
  args: string[];
  why: string;
  /** Skipped rather than failed when its precondition is absent. */
  skipIf?: () => string | null;
};

const NODE_FLAGS = [
  "--conditions=react-server",
  "--import", "./tests/resolver.mjs",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
];

// Ordered cheapest-first, so the fastest signal arrives first. A type error
// should not wait behind a 12-second end-to-end run.
const GATES: Gate[] = [
  {
    name: "types",
    command: "npx", args: ["tsc", "--noEmit"],
    why: "the contract between every module",
  },
  {
    name: "lint",
    command: "npx", args: ["eslint"],
    why: "a red lint hides the next real error",
  },
  {
    name: "test",
    command: "node", args: [...NODE_FLAGS, "tests/run.mts"],
    why: "the unit suite — the pieces",
  },
  {
    name: "e2e",
    command: "node", args: [...NODE_FLAGS, "scripts/e2e.mts"],
    why: "end-to-end — whether the pieces fit together",
  },
  {
    name: "eval",
    command: "node", args: [...NODE_FLAGS, "scripts/eval-retrieval.mts"],
    why: "retrieval is at recall@3 = 100%, so this can only detect DAMAGE",
  },
  {
    name: "verify",
    command: "node", args: [...NODE_FLAGS, "scripts/verify-live.mts"],
    why: "the blocked claims — needs a credential, and spends money",
    skipIf: () => {
      const key = process.env.ANTHROPIC_API_KEY;
      if (key === undefined || !key.startsWith("sk-ant-")) {
        return "no ANTHROPIC_API_KEY";
      }
      // Costs real money per run, so it is opt-in even when a key exists.
      // A gate that silently spends is a gate people disable.
      if (process.env.FORGE_VERIFY !== "1") return "set FORGE_VERIFY=1 to include it";
      return null;
    },
  },
];

const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", OFF = "\x1b[0m";
/**
 * In-place progress only makes sense on a terminal.
 *
 * Piped — which is what a CI log and a git hook both are — the carriage returns
 * and clear-line escapes render literally as `[K` and make the log worse than
 * plain output. Found by reading the hook's own output.
 */
const TTY = process.stdout.isTTY === true;
const CLEAR = "\x1b[K";

console.log(`\nforge-ai — check  ${DIM}(${GATES.length} gates, cheapest first)${OFF}\n`);

let failed: string | null = null;
const results: string[] = [];

for (const gate of GATES) {
  const skip = gate.skipIf?.() ?? null;
  if (skip !== null) {
    console.log(`  ${DIM}—${OFF} ${gate.name.padEnd(8)} ${DIM}skipped: ${skip}${OFF}`);
    results.push(`${gate.name}: skipped`);
    continue;
  }

  // On a terminal, show the gate as it runs and overwrite it with the result.
  // Piped, write nothing until there is a result to write.
  if (TTY) process.stdout.write(`  ${DIM}·${OFF} ${gate.name.padEnd(8)} ${DIM}${gate.why}${OFF}`);
  const started = Date.now();
  const run = spawnSync(gate.command, gate.args, { encoding: "utf8" });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (run.status === 0) {
    const done = `  ${GREEN}✓${OFF} ${gate.name.padEnd(8)} ${DIM}${seconds}s · ${gate.why}${OFF}\n`;
    process.stdout.write(TTY ? `\r${CLEAR}${done}` : done);
    results.push(`${gate.name}: ok`);
    continue;
  }

  const line = `  ${RED}✗${OFF} ${gate.name.padEnd(8)} ${DIM}${seconds}s${OFF}\n`;
  process.stdout.write(TTY ? `\r${CLEAR}${line}` : line);
  // Print the failing gate's own output. A gate runner that swallows it makes
  // the failure harder to fix than no gate at all.
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trimEnd();
  console.log(`\n${output}\n`);
  failed = gate.name;
  break; // stop at the first failure — later gates are slower and less specific
}

if (failed !== null) {
  console.log(`  ${RED}check failed at: ${failed}${OFF}\n`);
  process.exit(1);
}

console.log(`\n  ${GREEN}all gates passed${OFF}  ${DIM}${results.join(" · ")}${OFF}\n`);
