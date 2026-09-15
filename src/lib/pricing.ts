// Token pricing and cost arithmetic. No imports, no privileges — the same
// pattern as metrics.ts and stats.ts, and here the reason is sharper than
// usual: this module computes money, and money that cannot be checked by hand
// is money you are guessing at.
//
// Rates below are Anthropic first-party API prices, verified 2026-09-15.
// Bedrock and Vertex are partner-operated with separate pricing.

// ---------------------------------------------------------------------------
// MONEY IS NEVER A FLOAT.
//
//   0.1 + 0.2 === 0.30000000000000004
//
// Every cost here is an integer count of NANODOLLARS (1e-9 USD). That is not
// paranoia about a single request — it is about the sum. Add a million
// floating-point fractions of a cent and the error is real money that belongs
// to nobody and reconciles with nothing.
//
// Why nanodollars specifically: a price of $X per million tokens is exactly
// X * 1000 nanodollars per token, so every rate below is a whole number with no
// rounding anywhere in the arithmetic. Microdollars would not manage it —
// $0.50/MTok is 0.5 microdollars per token, and the fraction comes straight
// back.
//
// Headroom: Number.MAX_SAFE_INTEGER nanodollars is about $9,007,199. Far past
// anything this project will spend, and the assertion below fails loudly rather
// than silently losing precision if that is ever wrong.
// ---------------------------------------------------------------------------

export type Price = {
  /** Nanodollars per input token. */
  input: number;
  /** Nanodollars per output token. */
  output: number;
  /** Nanodollars per token READ from the prompt cache. 0.1x input. */
  cacheRead: number;
  /** Nanodollars per token WRITTEN to the cache, 5-minute TTL. 1.25x input. */
  cacheWrite5m: number;
  /** Nanodollars per token written with a 1-hour TTL. 2x input. */
  cacheWrite1h: number;
};

/** $X per million tokens → nanodollars per token. Exact for any 3dp price. */
function perMTok(dollars: number): number {
  const nano = dollars * 1000;
  if (!Number.isInteger(nano)) {
    throw new Error(`Price $${dollars}/MTok is not a whole number of nanodollars`);
  }
  return nano;
}

function priceFor(inputPerMTok: number, outputPerMTok: number): Price {
  return {
    input: perMTok(inputPerMTok),
    output: perMTok(outputPerMTok),
    cacheRead: perMTok(inputPerMTok * 0.1),
    cacheWrite5m: perMTok(inputPerMTok * 1.25),
    cacheWrite1h: perMTok(inputPerMTok * 2),
  };
}

export const PRICING: Record<string, Price> = {
  "claude-opus-5": priceFor(5, 25),
  "claude-opus-4-8": priceFor(5, 25),
  "claude-sonnet-5": priceFor(2, 10),
  "claude-haiku-4-5": priceFor(1, 5),
};

/** The model this project actually calls — see ai.ts. */
export const DEFAULT_MODEL = "claude-opus-5";

export class PricingError extends Error {}

/**
 * The token counts a Message response reports.
 *
 * Deliberately NOT the SDK's `Usage` type. The provider may add fields, and a
 * field this function silently ignores is a cost that silently vanishes —
 * see `assertAccounted()`.
 */
export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/**
 * Cost of one response, in nanodollars.
 *
 * An unknown model THROWS rather than costing zero. A silent zero is the worst
 * possible failure here: spending continues, the budget never notices, and the
 * logs agree that everything is fine.
 */
export function costOf(usage: TokenUsage, model: string): number {
  const price = PRICING[model];
  if (price === undefined) {
    throw new PricingError(`No pricing for model "${model}" — refusing to guess`);
  }

  const counts = [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_read_input_tokens ?? 0,
    usage.cache_creation_input_tokens ?? 0,
  ];
  for (const count of counts) {
    if (!Number.isInteger(count) || count < 0) {
      throw new PricingError(`Token counts must be non-negative integers, got ${count}`);
    }
  }

  // Cache CREATION is billed at the 5-minute write rate. The API reports one
  // `cache_creation_input_tokens` figure and this project never requests a
  // 1-hour TTL, so that is exact here — and would silently under-bill by 1.6x
  // if a 1h TTL were ever introduced. Recorded rather than assumed away.
  const total =
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
    (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite5m;

  if (!Number.isSafeInteger(total)) {
    throw new PricingError(`Cost ${total} exceeds safe integer range`);
  }
  return total;
}

/** Nanodollars → a human string. Display only; never feed this back into maths. */
export function formatCost(nanodollars: number): string {
  const dollars = nanodollars / 1e9;
  if (dollars === 0) return "$0";
  if (dollars < 0.01) return `$${dollars.toFixed(6)}`;
  return `$${dollars.toFixed(4)}`;
}

/** Dollars → nanodollars, for writing a budget as `$1.50` and storing an integer. */
export function dollars(amount: number): number {
  const nano = Math.round(amount * 1e9);
  if (!Number.isSafeInteger(nano)) throw new PricingError(`$${amount} is out of range`);
  return nano;
}

/**
 * Throws if the provider reported a token field this module does not price.
 *
 * The failure mode this exists to prevent: Anthropic adds a billable token
 * category, the response carries it, `costOf()` ignores what it does not
 * recognise, and every invoice is quietly larger than every total this project
 * has recorded. Failing loudly on an unknown field is much cheaper than
 * discovering the gap on a bill.
 */
const KNOWN_USAGE_FIELDS = new Set([
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
  // Reported by the API, not separately billable — they describe the request,
  // not additional tokens.
  "service_tier",
  "server_tool_use",
  "speed",
  "inference_geo",
  "iterations",
  "cache_creation",
]);

export function unpricedFields(usage: Record<string, unknown>): string[] {
  return Object.keys(usage).filter(
    (key) => !KNOWN_USAGE_FIELDS.has(key) && usage[key] !== null && usage[key] !== undefined,
  );
}
