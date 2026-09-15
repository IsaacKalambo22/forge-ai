// Experiment 018 — the cost projection.
//
// Same role as `pnpm eval` in 013: turn a question that was being answered by
// taste into a number. There the question was "is retrieval any good"; here it
// is "which context strategy should this project use", and the answer turns out
// to depend on conversation length in a way that is not obvious by inspection.
//
// Needs no API credential. The only estimated input is tokens-per-turn; every
// other number is exact arithmetic over published rates.
import { project, type Rates, type StrategyName } from "@/lib/context";
import { PRICING, formatCost, DEFAULT_MODEL } from "@/lib/pricing";
import { MAX_TURNS } from "@/lib/messages";

const price = PRICING[DEFAULT_MODEL];
const RATES: Rates = {
  input: price.input, output: price.output,
  cacheRead: price.cacheRead, cacheWrite: price.cacheWrite5m,
};

// A turn of a few sentences, and a reply of a few paragraphs. Output is larger
// than input per turn, which is typical and matters: output is billed at 5x.
const TOKENS_PER_TURN = 250;
const OUTPUT_PER_TURN = 400;
const WINDOW = 6;

const pad = (s: string, n: number) => s.padStart(n);

console.log(`\nforge-ai — context strategy cost projection`);
console.log(`${DEFAULT_MODEL}  ·  $${price.input / 1000}/MTok in, $${price.output / 1000}/MTok out`);
console.log(`${TOKENS_PER_TURN} tokens per turn, ${OUTPUT_PER_TURN} out, window = ${WINDOW}\n`);

const LENGTHS = [1, 2, 5, 10, 15, 20, 30, 50, 100];
const STRATEGIES: StrategyName[] = ["full", "window", "cached"];

console.log(`  ${pad("turns", 6)} ${pad("full", 11)} ${pad("window", 11)} ${pad("cached", 11)}   cheapest (lossless only)`);
console.log(`  ${"-".repeat(6)} ${"-".repeat(11)} ${"-".repeat(11)} ${"-".repeat(11)}   ${"-".repeat(24)}`);

for (const turns of LENGTHS) {
  const results = STRATEGIES.map((s) => project(s, turns, TOKENS_PER_TURN, OUTPUT_PER_TURN, RATES, WINDOW));
  const [full, win, cached] = results;

  // Ranked among strategies that do NOT drop history. A cheaper number bought
  // with forgetting is not the same kind of number.
  const lossless = results.filter((r) => r.forgottenTurns === 0);
  const best = lossless.reduce((a, b) => (a.costNanodollars <= b.costNanodollars ? a : b));

  const marker = turns === MAX_TURNS ? " ← MAX_TURNS" : "";
  console.log(
    `  ${pad(String(turns), 6)} ${pad(formatCost(full.costNanodollars), 11)}` +
    ` ${pad(formatCost(win.costNanodollars), 11)} ${pad(formatCost(cached.costNanodollars), 11)}` +
    `   ${best.strategy}${marker}`,
  );
}

console.log(`\n  The window column is NOT comparable to the others: it buys its price by`);
console.log(`  dropping history. At 20 turns it drops ${project("window", 20, TOKENS_PER_TURN, OUTPUT_PER_TURN, RATES, WINDOW).forgottenTurns} turn-sends the model never sees.\n`);

// Where does the window overtake caching? The cached prefix grows, so its read
// cost grows with it; a window is flat. There is a crossover, and it is
// computable rather than a matter of opinion.
// NOTE: there are TWO crossings, not one. At turn 2 the window is cheaper by a
// hair (caching has paid a 1.25x write and had almost nothing to read back);
// caching then wins for a long stretch; and eventually the growing prefix makes
// the window cheaper for good. The number that matters is the LAST crossing —
// taking the first reports turn 2 and is simply wrong.
let lastCachedWin = 0;
for (let turns = 2; turns <= 500; turns++) {
  const c = project("cached", turns, TOKENS_PER_TURN, OUTPUT_PER_TURN, RATES);
  const w = project("window", turns, TOKENS_PER_TURN, OUTPUT_PER_TURN, RATES, WINDOW);
  if (c.costNanodollars <= w.costNanodollars) lastCachedWin = turns;
}
console.log(`  Caching is cheaper than a ${WINDOW}-turn window up to turn ${lastCachedWin};`);
console.log(`  beyond that the growing cached prefix costs more to re-read than the`);
console.log(`  window costs to resend. Up to turn ${lastCachedWin}, caching is cheaper AND`);
console.log(`  lossless — there is no tradeoff to make at this project's scale.\n`);

// What the project actually pays today, at its own cap.
const today = project("full", MAX_TURNS, TOKENS_PER_TURN, OUTPUT_PER_TURN, RATES);
const withCache = project("cached", MAX_TURNS, TOKENS_PER_TURN, OUTPUT_PER_TURN, RATES);
const saving = today.costNanodollars - withCache.costNanodollars;
console.log(`  At this project's MAX_TURNS = ${MAX_TURNS}:`);
console.log(`    today (full history)  ${formatCost(today.costNanodollars)}  per conversation`);
console.log(`    with prefix caching   ${formatCost(withCache.costNanodollars)}`);
console.log(`    saving                ${formatCost(saving)}  (${((saving / today.costNanodollars) * 100).toFixed(0)}%), losing nothing\n`);

// The input/output split, because context management cannot touch output.
const inputCost = today.inputTokens * RATES.input;
const outputCost = today.outputTokens * RATES.output;
console.log(`  Where the money goes at ${MAX_TURNS} turns, full history:`);
console.log(`    input   ${pad(formatCost(inputCost), 10)}  ${((inputCost / today.costNanodollars) * 100).toFixed(0)}%   ← the only part context management can touch`);
console.log(`    output  ${pad(formatCost(outputCost), 10)}  ${((outputCost / today.costNanodollars) * 100).toFixed(0)}%   ← billed at 5x, untouched by any strategy here\n`);
