// Context strategies. No imports, no privileges — the metrics.ts / stats.ts /
// pricing.ts pattern, because this decides what the model is shown and what
// that costs, and both need to be checkable by hand.
//
// Experiment 003 measured the problem and did not solve it:
//
//   "History grows quadratically in tokens billed, because every turn resends
//    every prior turn. Measured, turn ten sends thirty times the bytes of turn
//    one."
//
// The project's entire response has been MAX_TURNS = 20 — a cliff, not a
// strategy. It does not reduce cost at all below turn 20; it only stops the
// conversation dead at it.

export type Turn = { role: "user" | "assistant"; content: string };

// ---------------------------------------------------------------------------
// TOKEN ESTIMATION — AND WHY THIS NUMBER IS NOT A MEASUREMENT
//
// The honest way to count tokens is the provider's `count_tokens` endpoint,
// which needs an API credential this project does not have. What follows is a
// heuristic: English text runs roughly 4 characters per token.
//
// It is used ONLY for projections and display, never for billing. Billing uses
// the `usage` object the API returns (Experiment 017), which is authoritative.
// Keeping the estimate away from the ledger is the point — an estimate that
// leaks into an invoice is a lie with a decimal point.
// ---------------------------------------------------------------------------

/** Rough token count. Unvalidated against a real tokenizer — see above. */
export function estimateTokens(text: string): number {
  if (text === "") return 0;
  // Ceil, so a short string is never estimated at zero tokens. Erring high is
  // the right direction for a budget projection.
  return Math.ceil(text.length / 4);
}

export function estimateTurnTokens(turns: Turn[]): number {
  // Each message carries a few tokens of role/structure overhead beyond its
  // text. Small, and it compounds over a long history, so it is not dropped.
  const PER_MESSAGE_OVERHEAD = 4;
  return turns.reduce((sum, t) => sum + estimateTokens(t.content) + PER_MESSAGE_OVERHEAD, 0);
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

export type StrategyName = "full" | "window" | "cached";

/**
 * A sliding window: the most recent `maxTurns` messages.
 *
 * WHAT THIS COSTS THAT IS NOT MONEY: the model stops being able to see the
 * dropped turns. It is not compression — it is forgetting, and the user is not
 * told. A fact established in turn 2 is simply gone by turn 30, and the model
 * will confidently proceed without it.
 *
 * Kept anchored to a whole turn boundary and always ending on a user message,
 * because the API requires the conversation to end on one.
 */
export function windowed(turns: Turn[], maxTurns: number): Turn[] {
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error(`Window must be a positive integer, got ${maxTurns}`);
  }
  if (turns.length <= maxTurns) return turns;

  let window = turns.slice(-maxTurns);
  // The API requires the first message to be a user turn. Dropping a leading
  // assistant message is cheaper than sending an invalid request.
  while (window.length > 0 && window[0].role !== "user") window = window.slice(1);
  return window;
}

// ---------------------------------------------------------------------------
// Cost projection
//
// Given a per-turn token size, what does an N-turn conversation cost under each
// strategy? Exact arithmetic — the only estimated input is the token size.
// ---------------------------------------------------------------------------

export type Rates = {
  /** Nanodollars per token. From pricing.ts, passed in rather than imported. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type Projection = {
  strategy: StrategyName;
  /** Input tokens billed at the full rate, summed over the conversation. */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costNanodollars: number;
  /** Turns the model could no longer see, summed over the conversation. */
  forgottenTurns: number;
};

/**
 * Projects the cost of an `turns`-turn conversation.
 *
 * Every turn is modelled as the same size, which is a simplification and makes
 * the SHAPE of the curve visible without pretending to predict one real
 * conversation.
 */
export function project(
  strategy: StrategyName,
  turns: number,
  tokensPerTurn: number,
  outputTokensPerTurn: number,
  rates: Rates,
  window = 6,
): Projection {
  if (!Number.isInteger(turns) || turns < 1) {
    throw new Error(`turns must be a positive integer, got ${turns}`);
  }

  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let forgottenTurns = 0;

  for (let turn = 1; turn <= turns; turn++) {
    // The history resent on this turn: every prior user+assistant pair, plus
    // this turn's user message.
    const historyTurns = (turn - 1) * 2 + 1;
    const historyTokens = historyTurns * tokensPerTurn;

    if (strategy === "full") {
      inputTokens += historyTokens;
    } else if (strategy === "window") {
      const sent = Math.min(historyTurns, window);
      inputTokens += sent * tokensPerTurn;
      forgottenTurns += Math.max(0, historyTurns - window);
    } else {
      // Cached: everything before this turn's new message is a stable prefix.
      // It is written once and read on every subsequent turn. The new user
      // message and the growth since the last write are billed as fresh input.
      const prefixTurns = historyTurns - 1;
      if (turn === 1) {
        inputTokens += historyTokens;
      } else {
        // The prefix grew by one user+assistant pair since the last request, so
        // that much is newly written; the rest is read.
        cacheReadTokens += Math.max(0, prefixTurns - 2) * tokensPerTurn;
        cacheWriteTokens += Math.min(prefixTurns, 2) * tokensPerTurn;
        inputTokens += tokensPerTurn; // this turn's new user message
      }
    }
  }

  const outputTokens = turns * outputTokensPerTurn;
  const costNanodollars =
    inputTokens * rates.input +
    cacheReadTokens * rates.cacheRead +
    cacheWriteTokens * rates.cacheWrite +
    outputTokens * rates.output;

  return {
    strategy, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens,
    costNanodollars, forgottenTurns,
  };
}
