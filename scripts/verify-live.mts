// Experiment 020 — `pnpm verify`.
//
// Turns a credential into answers. Without one it prints the verification debt
// as a table, which is useful on its own: it is the project's honest inventory
// of what is built-but-unobserved.
//
// The evaluators live in src/lib/claims.ts and are unit-tested against recorded
// fixtures. This file only FETCHES. That split is deliberate — the judgement is
// verified today; a key supplies the input.
import Anthropic from "@anthropic-ai/sdk";

import { CLAIMS, SDK_CLAIMS, APP_CLAIMS, type Claim, type Verdict } from "@/lib/claims";
import { PRICING, costOf, formatCost } from "@/lib/pricing";

const MODEL = "claude-opus-5";

const key = process.env.ANTHROPIC_API_KEY;
const haveCredential = key !== undefined && key !== "" && key.startsWith("sk-ant-");

const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", YELLOW = "\x1b[33m", OFF = "\x1b[0m";

console.log(`\nforge-ai — live verification`);
console.log(`${CLAIMS.length} claims across ${new Set(CLAIMS.map((c) => c.experiment)).size} experiments\n`);

if (!haveCredential) {
  console.log(`${YELLOW}  No ANTHROPIC_API_KEY. Nothing below has been observed.${OFF}\n`);
  console.log(`  A Claude.ai or ChatGPT subscription is NOT an API credential — they are`);
  console.log(`  separate accounts with separate billing. A key looks like sk-ant-...\n`);
  console.log(`  ${"claim".padEnd(34)} ${"experiment".padEnd(24)} question`);
  console.log(`  ${"-".repeat(34)} ${"-".repeat(24)} ${"-".repeat(20)}`);
  for (const claim of CLAIMS) {
    console.log(`  ${DIM}?${OFF} ${claim.id.padEnd(32)} ${claim.experiment.padEnd(24)} ${claim.question}`);
    console.log(`    ${DIM}needs: ${claim.evidence}${OFF}`);
  }
  console.log(`\n  ${CLAIMS.length} claims blocked. The evaluators for all of them are unit-tested`);
  console.log(`  against fixtures — run \`pnpm test\`. Only the evidence is missing.\n`);
  console.log(`  Coverage of this harness: ${SDK_CLAIMS.length} of ${CLAIMS.length} are gathered by a direct API call.`);
  console.log(`  The other ${APP_CLAIMS.length} need the running application and are NOT yet gathered:`);
  for (const c of APP_CLAIMS) console.log(`    ${DIM}- ${c.id}${OFF}`);
  console.log();
  console.log(`  To run for real:  ANTHROPIC_API_KEY=sk-ant-... pnpm verify\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live. Everything below spends real money.
// ---------------------------------------------------------------------------

const client = new Anthropic();
let spent = 0;

function bill(usage: Anthropic.Usage, model: string): void {
  try { spent += costOf(usage, model); } catch { /* unknown model: reported by its own claim */ }
}

const QUESTION = "What is the capital of France?";

/** Collects the evidence for every claim, then evaluates. */
async function gather(): Promise<Map<string, unknown>> {
  const evidence = new Map<string, unknown>();

  // One ordinary call — serves the 001 and 017 claims.
  const basic = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: QUESTION }],
  });
  bill(basic.usage, basic.model);
  evidence.set("001-content-blocks", basic);
  evidence.set("017-live-usage-row", basic.usage);

  // A deliberately tiny ceiling, to make stop_reason flip. This is the one
  // place a small max_tokens is correct rather than a mistake.
  const truncated = await client.messages.create({
    model: MODEL,
    max_tokens: 16,
    messages: [{ role: "user", content: "Explain the history of France in detail." }],
  });
  bill(truncated.usage, truncated.model);
  evidence.set("001-max-tokens-stop-reason", truncated);

  // The same question under two system prompts — Experiment 002's open question.
  const text = (m: Anthropic.Message) =>
    m.content.filter((b) => b.type === "text").map((b) => b.text).join("");

  const [plain, terse] = await Promise.all([
    client.messages.create({
      model: MODEL, max_tokens: 1024,
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: QUESTION }],
    }),
    client.messages.create({
      model: MODEL, max_tokens: 1024,
      system: "You are a terse assistant. Answer in one sentence. No preamble, " +
        "no restating the question, no closing offer to help further.",
      messages: [{ role: "user", content: QUESTION }],
    }),
  ]);
  bill(plain.usage, plain.model);
  bill(terse.usage, terse.model);
  evidence.set("002-personas-change-behaviour", {
    default_answer: text(plain), terse_answer: text(terse),
  });

  // Two turns over one prefix, with a cache breakpoint — Experiment 018's claim.
  // The prefix is padded past the minimum cacheable size deliberately: below it
  // the API silently does not cache, which would look like a failure and is not.
  const padding = "Background notes for reference.\n".repeat(400);
  const cachedSystem: Anthropic.TextBlockParam[] = [
    { type: "text", text: padding, cache_control: { type: "ephemeral" } },
  ];
  const first = await client.messages.create({
    model: MODEL, max_tokens: 256, system: cachedSystem,
    messages: [{ role: "user", content: "Say 'one'." }],
  });
  bill(first.usage, first.model);
  const second = await client.messages.create({
    model: MODEL, max_tokens: 256, system: cachedSystem,
    messages: [{ role: "user", content: "Say 'two'." }],
  });
  bill(second.usage, second.model);
  evidence.set("018-cache-actually-hits", second.usage);

  return evidence;
}

let evidence: Map<string, unknown>;
try {
  evidence = await gather();
} catch (error) {
  console.error(`${RED}  Failed while gathering evidence:${OFF} ${(error as Error).message}\n`);
  process.exit(1);
}

let passed = 0, failed = 0, skipped = 0;
const results: { claim: Claim; verdict: Verdict | null }[] = [];

for (const claim of CLAIMS) {
  if (!evidence.has(claim.id)) {
    // Honest about what this harness does NOT yet fetch, rather than silently
    // reporting fewer claims than it lists.
    results.push({ claim, verdict: null });
    skipped++;
    continue;
  }
  const verdict = claim.evaluate(evidence.get(claim.id));
  results.push({ claim, verdict });
  if (verdict.status === "pass") passed++;
  else failed++;
}

console.log(`  ${"claim".padEnd(34)} verdict`);
console.log(`  ${"-".repeat(34)} ${"-".repeat(40)}`);
for (const { claim, verdict } of results) {
  if (verdict === null) {
    console.log(`  ${DIM}—${OFF} ${claim.id.padEnd(32)} ${DIM}not gathered by this harness yet${OFF}`);
    continue;
  }
  const mark = verdict.status === "pass" ? `${GREEN}✓${OFF}`
    : verdict.status === "fail" ? `${RED}✗${OFF}` : `${YELLOW}?${OFF}`;
  console.log(`  ${mark} ${claim.id.padEnd(32)} ${verdict.detail}`);
}

console.log(`\n  ${passed} passed, ${failed} failed, ${skipped} not gathered`);
console.log(`  cost of this run: ${formatCost(spent)}  (${MODEL} at $${PRICING[MODEL].input / 1000}/$${PRICING[MODEL].output / 1000} per MTok)\n`);

process.exit(failed > 0 ? 1 : 0);
