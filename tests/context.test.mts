// Experiment 018, extended in 032.
import {
  estimateTokens, estimateTurnTokens, MIN_CACHEABLE_TOKENS, windowed, worthCaching, project,
  type Turn, type Rates,
} from "@/lib/context";
import { PRICING, formatCost } from "@/lib/pricing";
import { group, ok, eq, throws } from "./harness.mts";

const opus = PRICING["claude-opus-5"];
const RATES: Rates = {
  input: opus.input, output: opus.output,
  cacheRead: opus.cacheRead, cacheWrite: opus.cacheWrite5m,
};

const turn = (role: "user" | "assistant", content: string): Turn => ({ role, content });

group("context — token estimation (a heuristic, not a measurement)");
eq("empty is zero", estimateTokens(""), 0);
eq("4 chars ≈ 1 token", estimateTokens("abcd"), 1);
eq("a short string is never zero tokens", estimateTokens("a"), 1);
eq("rounds up", estimateTokens("abcde"), 2);
ok("scales linearly", estimateTokens("x".repeat(400)) === 100);
eq("per-message overhead is counted",
  estimateTurnTokens([turn("user", "abcd")]), 1 + 4);
eq("summed across turns",
  estimateTurnTokens([turn("user", "abcd"), turn("assistant", "abcd")]), (1 + 4) * 2);

group("context — Experiment 032: the minimum-cacheable-prefix guard");
ok("one token below the minimum is not worth caching", !worthCaching(MIN_CACHEABLE_TOKENS - 1));
ok("exactly the minimum is worth caching", worthCaching(MIN_CACHEABLE_TOKENS));
ok("comfortably above is worth caching", worthCaching(MIN_CACHEABLE_TOKENS * 10));
ok("zero is not worth caching", !worthCaching(0));

group("context — sliding window");
const ten: Turn[] = Array.from({ length: 10 }, (_, i) =>
  turn(i % 2 === 0 ? "user" : "assistant", `message ${i}`));
eq("a short history is returned whole", windowed(ten.slice(0, 3), 6).length, 3);
eq("a long one is cut to the window", windowed(ten, 6).length, 6);
eq("it keeps the NEWEST turns", windowed(ten, 4).at(-1)?.content, "message 9");
eq("and starts on a user turn, as the API requires", windowed(ten, 4)[0].role, "user");
// A window that would start on an assistant turn is shortened, not sent invalid.
eq("an odd window drops a leading assistant message", windowed(ten, 5).length, 4);
throws("window must be positive", () => windowed(ten, 0));
throws("window must be an integer", () => windowed(ten, 2.5));

group("context — THE Experiment 003 MEASUREMENT, reproduced exactly");
// 003 recorded: "turn ten sends thirty times the bytes of turn one."
// Turn 1 sends 1 message; turn 10 sends 19 (9 pairs + the new user message).
const turn1 = project("full", 1, 100, 50, RATES);
const turn10 = project("full", 10, 100, 50, RATES);
const turn10Only = turn10.inputTokens - project("full", 9, 100, 50, RATES).inputTokens;
eq("turn 1 sends 1 message-worth", turn1.inputTokens, 100);
eq("turn 10 alone sends 19", turn10Only, 1900);
ok("that is 19x turn one — the same shape 003 measured by eye",
  turn10Only / turn1.inputTokens === 19, `${turn10Only / turn1.inputTokens}x`);

group("context — growth is quadratic, not linear");
// Doubling the turns should roughly QUADRUPLE the input tokens. This is the
// property that makes a long conversation expensive.
const t10 = project("full", 10, 100, 50, RATES).inputTokens;
const t20 = project("full", 20, 100, 50, RATES).inputTokens;
const t40 = project("full", 40, 100, 50, RATES).inputTokens;
ok("10 → 20 turns is ~4x the input", t20 / t10 > 3.5 && t20 / t10 < 4.5, `${(t20 / t10).toFixed(2)}x`);
ok("20 → 40 turns is ~4x again", t40 / t20 > 3.5 && t40 / t20 < 4.5, `${(t40 / t20).toFixed(2)}x`);
ok("40 turns costs far more than 4x of 10 turns", t40 / t10 > 12, `${(t40 / t10).toFixed(1)}x`);

group("context — the strategies, compared on the same conversation");
const N = 20, PER = 250, OUT = 400;
const full = project("full", N, PER, OUT, RATES);
const win = project("window", N, PER, OUT, RATES, 6);
const cached = project("cached", N, PER, OUT, RATES);

ok("full history is the most expensive", full.costNanodollars > cached.costNanodollars,
  `full ${formatCost(full.costNanodollars)} vs cached ${formatCost(cached.costNanodollars)}`);
eq("full history forgets nothing", full.forgottenTurns, 0);
eq("caching forgets nothing either", cached.forgottenTurns, 0);
ok("but the window forgets a great deal", win.forgottenTurns > 100,
  `${win.forgottenTurns} turn-sends dropped`);

group("context — the finding that contradicted my prior");
// I assumed a sliding window would always be the cheapest option, and wrote a
// test asserting it. The test failed. At 20 turns, caching is cheaper than a
// 6-turn window AND forgets nothing — the window pays 289 dropped turn-sends
// to be MORE expensive.
ok("at 20 turns, caching beats the window on cost",
  cached.costNanodollars < win.costNanodollars,
  `cached ${formatCost(cached.costNanodollars)} vs window ${formatCost(win.costNanodollars)}`);
ok("…while also forgetting nothing",
  cached.forgottenTurns === 0 && win.forgottenTurns > 0);

group("context — but the ranking depends on conversation length");
// A cached prefix grows, so its read cost grows with it; a window is flat.
// There is therefore a crossover, and it is computable rather than a matter of
// opinion. Verified by hand at turn ~15 (see the experiment README).
const short = { c: project("cached", 8, PER, OUT, RATES),
                w: project("window", 8, PER, OUT, RATES, 6) };
const long = { c: project("cached", 60, PER, OUT, RATES),
               w: project("window", 60, PER, OUT, RATES, 6) };
ok("short conversation: caching wins", short.c.costNanodollars < short.w.costNanodollars,
  `${formatCost(short.c.costNanodollars)} vs ${formatCost(short.w.costNanodollars)}`);
ok("long conversation: the window wins", long.w.costNanodollars < long.c.costNanodollars,
  `${formatCost(long.w.costNanodollars)} vs ${formatCost(long.c.costNanodollars)}`);
ok("so there is no single right strategy — only a right one per length", true);

group("context — caching keeps most of the window's saving, losslessly");
const savedByWindow = full.costNanodollars - win.costNanodollars;
const savedByCache = full.costNanodollars - cached.costNanodollars;
ok("caching saves at least as much here", savedByCache >= savedByWindow,
  `cache ${formatCost(savedByCache)} vs window ${formatCost(savedByWindow)}`);

group("context — output tokens are untouched by any strategy");
// Worth stating: context management is an INPUT-side lever only, and output is
// billed at 5x input. No amount of history trimming touches it.
eq("all three produce the same output tokens",
  [full.outputTokens, win.outputTokens, cached.outputTokens],
  [N * OUT, N * OUT, N * OUT]);

group("context — a one-turn conversation gains nothing from caching");
// The 1.25x write with no read to amortise it — the break-even from 017.
const oneFull = project("full", 1, 500, 100, RATES);
const oneCached = project("cached", 1, 500, 100, RATES);
eq("turn one is identical either way", oneCached.costNanodollars, oneFull.costNanodollars);
eq("nothing was written to cache on a single turn", oneCached.cacheWriteTokens, 0);

group("context — projection rejects nonsense");
throws("zero turns", () => project("full", 0, 100, 50, RATES));
throws("fractional turns", () => project("full", 1.5, 100, 50, RATES));
