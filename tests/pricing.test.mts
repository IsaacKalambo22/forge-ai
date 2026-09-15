// Experiment 017. This module computes money, so every expected value here is
// worked out by hand in the label. Published Anthropic rates, 2026-09-15:
// Opus 5 = $5.00/MTok in, $25.00/MTok out. Cache read 0.1x, write 1.25x (5m).
import {
  PRICING, costOf, formatCost, dollars, unpricedFields, DEFAULT_MODEL,
} from "@/lib/pricing";
import { group, ok, eq, throws } from "./harness.mts";

const MTOK = 1_000_000;

group("pricing — the rate table");
const opus = PRICING["claude-opus-5"];
eq("Opus 5 input: $5/MTok = 5000 nanodollars/token", opus.input, 5_000);
eq("Opus 5 output: $25/MTok = 25000", opus.output, 25_000);
eq("cache read is 0.1x input ($0.50/MTok)", opus.cacheRead, 500);
eq("cache write 5m is 1.25x input ($6.25/MTok)", opus.cacheWrite5m, 6_250);
eq("cache write 1h is 2x input ($10/MTok)", opus.cacheWrite1h, 10_000);
eq("Sonnet 5 is cheaper: $2/$10", [PRICING["claude-sonnet-5"].input, PRICING["claude-sonnet-5"].output],
  [2_000, 10_000]);
ok("the project's model is priced", PRICING[DEFAULT_MODEL] !== undefined, DEFAULT_MODEL);

group("pricing — every rate is a whole number of nanodollars");
// The reason for choosing nanodollars over microdollars: $0.50/MTok is 0.5
// microdollars per token, and that fraction comes straight back as a float.
ok("no fractional rates anywhere",
  Object.values(PRICING).every((p) => Object.values(p).every(Number.isInteger)));

group("pricing — cost arithmetic");
eq("1M in + 1M out on Opus 5 = $30",
  costOf({ input_tokens: MTOK, output_tokens: MTOK }, "claude-opus-5"), dollars(30));
eq("1000 in + 500 out = $0.005 + $0.0125 = $0.0175",
  costOf({ input_tokens: 1000, output_tokens: 500 }, "claude-opus-5"), dollars(0.0175));
eq("zero tokens costs nothing",
  costOf({ input_tokens: 0, output_tokens: 0 }, "claude-opus-5"), 0);
eq("cache reads are billed at a tenth",
  costOf({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: MTOK }, "claude-opus-5"),
  dollars(0.5));
eq("cache writes cost a quarter more than input",
  costOf({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: MTOK }, "claude-opus-5"),
  dollars(6.25));
eq("null cache fields are treated as zero",
  costOf({ input_tokens: 100, output_tokens: 0, cache_read_input_tokens: null,
    cache_creation_input_tokens: null }, "claude-opus-5"),
  costOf({ input_tokens: 100, output_tokens: 0 }, "claude-opus-5"));

group("pricing — integers do not drift, floats do");
// The whole argument for integer money, demonstrated rather than asserted.
// A thousand identical small charges, summed.
const oneCall = costOf({ input_tokens: 1234, output_tokens: 567 }, "claude-opus-5");
let integerTotal = 0;
for (let i = 0; i < 1000; i++) integerTotal += oneCall;
eq("1000 identical charges sum exactly", integerTotal, oneCall * 1000);
ok("and the total is still an exact integer", Number.isSafeInteger(integerTotal));

let floatTotal = 0;
const asDollars = oneCall / 1e9;
for (let i = 0; i < 1000; i++) floatTotal += asDollars;
ok("the same sum in floating-point dollars does NOT land exactly",
  floatTotal !== asDollars * 1000,
  `drifted by ${Math.abs(floatTotal - asDollars * 1000).toExponential(3)} dollars`);

group("pricing — an unknown model throws rather than costing zero");
// The worst possible failure: spending continues, the budget never notices,
// and the logs agree everything is fine.
throws("unknown model", () => costOf({ input_tokens: 1, output_tokens: 1 }, "gpt-4"));
throws("empty model", () => costOf({ input_tokens: 1, output_tokens: 1 }, ""));
throws("a model id with a date suffix is NOT silently accepted",
  () => costOf({ input_tokens: 1, output_tokens: 1 }, "claude-opus-5-20260401"));

group("pricing — rejects impossible token counts");
throws("negative input", () => costOf({ input_tokens: -1, output_tokens: 0 }, "claude-opus-5"));
throws("fractional tokens", () => costOf({ input_tokens: 1.5, output_tokens: 0 }, "claude-opus-5"));
throws("NaN", () => costOf({ input_tokens: NaN, output_tokens: 0 }, "claude-opus-5"));

group("pricing — an unpriced usage field is detected, not ignored");
// If Anthropic adds a billable token category, every invoice would quietly
// exceed every total recorded here. Failing loudly is cheaper than a bill.
eq("a known response has nothing unpriced",
  unpricedFields({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0,
    service_tier: "standard" }), []);
eq("a new billable field is surfaced",
  unpricedFields({ input_tokens: 10, output_tokens: 5, reasoning_tokens: 900 }),
  ["reasoning_tokens"]);
eq("nulls are not flagged", unpricedFields({ input_tokens: 1, something_new: null }), []);

group("pricing — formatting is for display only");
eq("a normal cost", formatCost(dollars(0.0175)), "$0.0175");
eq("a tiny cost keeps precision", formatCost(1500), "$0.000002");
eq("zero", formatCost(0), "$0");
eq("dollars() round-trips", formatCost(dollars(1.5)), "$1.5000");
