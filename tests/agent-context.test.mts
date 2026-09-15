// Experiment 019.
import {
  pruneToolResults, estimateMessageTokens, projectAgentRun, CLEARED_NOTICE,
  type Message, type Rates,
} from "@/lib/context";
import { PRICING, formatCost } from "@/lib/pricing";
import { MAX_STEPS } from "@/lib/agent";
import { group, ok, eq, throws } from "./harness.mts";

const opus = PRICING["claude-opus-5"];
const RATES: Rates = {
  input: opus.input, output: opus.output,
  cacheRead: opus.cacheRead, cacheWrite: opus.cacheWrite5m,
};

/** A working history of `steps` tool round-trips, as the agent loop builds it. */
function history(steps: number): Message[] {
  const out: Message[] = [{ role: "user", content: "the question" }];
  for (let i = 0; i < steps; i++) {
    out.push({ role: "assistant", content: [
      { type: "tool_use", id: `t${i}`, name: "search_notebook", input: { query: `q${i}` } },
    ] });
    out.push({ role: "user", content: [
      { type: "tool_result", tool_use_id: `t${i}`, content: `a long retrieved passage ${i} `.repeat(40) },
    ] });
  }
  return out;
}

const resultContents = (ms: Message[]) =>
  ms.flatMap((m) => Array.isArray(m.content) ? m.content : [])
    .filter((b) => b.type === "tool_result")
    .map((b) => String(b.content));

group("agent-context — pruning clears content, never the block");
// THE constraint: every tool_use must have a matching tool_result. Dropping a
// stale result makes the request INVALID, not cheaper.
const four = history(4);
const pruned = pruneToolResults(four, 1);
eq("no messages were removed", pruned.length, four.length);
eq("every tool_result block survives", resultContents(pruned).length, 4);
eq("the tool_use blocks are untouched",
  pruned.filter((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use")).length, 4);

group("agent-context — only the older results are cleared");
const contents = resultContents(pruned);
eq("the three oldest are placeholders",
  contents.slice(0, 3).every((c) => c === CLEARED_NOTICE), true);
ok("the newest is kept in full", contents[3].includes("a long retrieved passage 3"));
ok("and the placeholder is short", CLEARED_NOTICE.length < 60, `${CLEARED_NOTICE.length} chars`);

group("agent-context — tool_use_id pairing is preserved exactly");
// If an id were lost or changed, the request would be malformed in a way that
// only shows up as a 400 from the provider.
const ids = (ms: Message[]) => ms.flatMap((m) => Array.isArray(m.content) ? m.content : [])
  .filter((b) => b.type === "tool_result").map((b) => b.tool_use_id);
eq("ids are identical before and after", ids(pruned), ids(four));

group("agent-context — keepRecent controls how much is kept");
eq("keep 2", resultContents(pruneToolResults(four, 2)).filter((c) => c === CLEARED_NOTICE).length, 2);
eq("keep all", resultContents(pruneToolResults(four, 4)).filter((c) => c === CLEARED_NOTICE).length, 0);
eq("keep more than exist is a no-op",
  resultContents(pruneToolResults(four, 99)).filter((c) => c === CLEARED_NOTICE).length, 0);
eq("keep none clears everything",
  resultContents(pruneToolResults(four, 0)).filter((c) => c === CLEARED_NOTICE).length, 4);
throws("negative keepRecent", () => pruneToolResults(four, -1));

group("agent-context — the input is not mutated");
const original = history(2);
pruneToolResults(original, 0);
ok("the caller's history still has its content",
  resultContents(original).every((c) => c !== CLEARED_NOTICE));

group("agent-context — pruning is a large saving because results dominate");
const before = estimateMessageTokens(four);
const after = estimateMessageTokens(pruneToolResults(four, 1));
ok("pruning cuts the working history substantially", after < before * 0.5,
  `${before} → ${after} tokens (${((1 - after / before) * 100).toFixed(0)}% smaller)`);

group("agent-context — the loop's own quadratic");
// Same shape as Experiment 003's conversation curve, inside ONE http request.
const q = 50, result = 800, assistant = 60;
const s2 = projectAgentRun("full", 2, q, result, assistant, RATES).inputTokens;
const s4 = projectAgentRun("full", 4, q, result, assistant, RATES).inputTokens;
const s6 = projectAgentRun("full", 6, q, result, assistant, RATES).inputTokens;
ok("doubling the steps more than doubles the input", s4 / s2 > 2.5, `${(s4 / s2).toFixed(2)}x`);
ok("and again", s6 / s4 > 1.8, `${(s6 / s4).toFixed(2)}x`);

group("agent-context — the strategies at this project's MAX_STEPS");
const full = projectAgentRun("full", MAX_STEPS, q, result, assistant, RATES);
const cached = projectAgentRun("cached", MAX_STEPS, q, result, assistant, RATES);
const prunedRun = projectAgentRun("pruned", MAX_STEPS, q, result, assistant, RATES);
const both = projectAgentRun("pruned+cached", MAX_STEPS, q, result, assistant, RATES);

ok("caching helps", cached.costNanodollars < full.costNanodollars,
  `${formatCost(cached.costNanodollars)} vs ${formatCost(full.costNanodollars)}`);
ok("pruning helps", prunedRun.costNanodollars < full.costNanodollars,
  `${formatCost(prunedRun.costNanodollars)}`);
ok("pruning alone beats caching alone", prunedRun.costNanodollars < cached.costNanodollars,
  `pruned ${formatCost(prunedRun.costNanodollars)} vs cached ${formatCost(cached.costNanodollars)}`);

group("agent-context — combining the two optimisations makes things WORSE");
// I assumed pruning + caching would be the cheapest and wrote it as a test. It
// failed. Pruning does not append — it EDITS an earlier tool result from a full
// passage to a placeholder, and caching is a PREFIX match, so that edit moves
// the divergence point backwards and invalidates the cache from there.
//
// The first optimisation destroys the precondition the second depends on.
ok("pruned+cached is more expensive than pruning alone",
  both.costNanodollars > prunedRun.costNanodollars,
  `${formatCost(both.costNanodollars)} vs ${formatCost(prunedRun.costNanodollars)}`);
ok("because the cache is barely read at all",
  both.cacheReadTokens < cached.cacheReadTokens * 0.2,
  `${both.cacheReadTokens} read vs ${cached.cacheReadTokens} when only caching`);
ok("while the 1.25x write premium is still paid in full",
  both.cacheWriteTokens >= cached.cacheWriteTokens,
  `${both.cacheWriteTokens} written vs ${cached.cacheWriteTokens}`);

group("agent-context — caching needs an APPEND-ONLY history");
// The general rule, and the reason 018 reached the opposite conclusion for
// conversations: a conversation only ever appends, so its prefix stays stable.
const appendOnly = projectAgentRun("cached", MAX_STEPS, q, result, assistant, RATES);
ok("append-only: most of the history is read, not rewritten",
  appendOnly.cacheReadTokens > appendOnly.cacheWriteTokens,
  `${appendOnly.cacheReadTokens} read vs ${appendOnly.cacheWriteTokens} written`);
ok("edited history: most of it is rewritten every step",
  both.cacheWriteTokens > both.cacheReadTokens,
  `${both.cacheWriteTokens} written vs ${both.cacheReadTokens} read`);

group("agent-context — a one-step run has nothing to save");
// Nothing has accumulated yet, so every strategy sends the same thing.
const oneFull = projectAgentRun("full", 1, q, result, assistant, RATES);
const oneBoth = projectAgentRun("pruned+cached", 1, q, result, assistant, RATES);
eq("identical on step one", oneBoth.costNanodollars, oneFull.costNanodollars);
eq("nothing cached yet", oneBoth.cacheReadTokens, 0);

group("agent-context — projection rejects nonsense");
throws("zero steps", () => projectAgentRun("full", 0, q, result, assistant, RATES));
throws("fractional steps", () => projectAgentRun("full", 1.5, q, result, assistant, RATES));
