// Experiment 027 — `pnpm ci-status`. Makes the CI result visible from the terminal.
//
// 026 found CI failing three times with nothing local noticing, because "CI
// exists" and "CI is green" look identical from a terminal — nothing reads
// the result. This reads it: the public GitHub API works unauthenticated for
// a public repo, so no credential is needed for the thing that was actually
// missing.
import { execFileSync } from "node:child_process";

function sh(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function originSlug(): string {
  const url = sh("git", ["remote", "get-url", "origin"]);
  // Handles both git@github.com:owner/repo.git and https://github.com/owner/repo.git
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/);
  if (!match) throw new Error(`origin is not a GitHub remote: ${url}`);
  return `${match[1]}/${match[2]}`;
}

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", OFF = "\x1b[0m";

const repo = originSlug();
const sha = sh("git", ["rev-parse", "HEAD"]);

console.log(`\nforge-ai — ci-status  ${DIM}(${repo} @ ${sha.slice(0, 7)})${OFF}\n`);

const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs`, {
  headers: { Accept: "application/vnd.github+json" },
});

if (!res.ok) {
  // A commit GitHub has never seen (not pushed yet) 404s here — that is itself
  // the answer, not an error to hide.
  console.log(`  ${YELLOW}?${OFF} no check runs found for this commit ${DIM}(${res.status} — pushed yet?)${OFF}\n`);
  process.exit(2);
}

const { check_runs } = (await res.json()) as {
  check_runs: { name: string; status: string; conclusion: string | null; html_url: string }[];
};

if (check_runs.length === 0) {
  console.log(`  ${YELLOW}?${OFF} no check runs found for this commit ${DIM}(pushed yet?)${OFF}\n`);
  process.exit(2);
}

let worst = 0; // 0 = all passed, 1 = pending, 2 = failed
for (const run of check_runs) {
  if (run.status !== "completed") {
    console.log(`  ${YELLOW}·${OFF} ${run.name.padEnd(10)} ${DIM}${run.status}${OFF}`);
    worst = Math.max(worst, 1);
    continue;
  }
  const ok = run.conclusion === "success";
  const icon = ok ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`;
  console.log(`  ${icon} ${run.name.padEnd(10)} ${DIM}${run.conclusion}  ${run.html_url}${OFF}`);
  if (!ok) worst = 2;
}

console.log();
process.exit(worst === 2 ? 1 : worst === 1 ? 2 : 0);
