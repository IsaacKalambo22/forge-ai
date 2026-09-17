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

// ---------------------------------------------------------------------------
// Experiment 032 (continuing 018 & 031) — the minimum cacheable prefix,
// guarded instead of just documented.
//
// Anthropic's published minimum is model-dependent — roughly 1024 tokens for
// Opus/Sonnet, 2048 for Haiku (this project only calls Opus/Sonnet, so the
// lower number applies). Below it, `cache_control` is accepted by the API but
// produces no `cache_read_input_tokens` on any later request — silently, per
// the notes in `ai.ts`. That alone would just be a missed opportunity. What
// makes it a LOSS rather than a no-op: a write below the minimum still seems
// to pay the 1.25x write premium, for a read that can mathematically never
// happen. Marking a too-small prefix is worse than not marking it at all.
//
// This is the documented floor, not a measured one — the same status as
// every other number in this file. It exists to decide WHETHER to attempt
// marking, before any request is sent, not to predict a saving.
export const MIN_CACHEABLE_TOKENS = 1024;

/** Is this estimated size large enough that marking `cache_control` could
 * plausibly help, rather than just paying the write premium for nothing? */
export function worthCaching(estimatedTokens: number): boolean {
  return estimatedTokens >= MIN_CACHEABLE_TOKENS;
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

// ---------------------------------------------------------------------------
// Experiment 019 — the agent loop's own context.
//
// 018 fixed the quadratic BETWEEN requests and left it untouched INSIDE one.
// The agent loop appends the model's tool_use blocks and our tool results to a
// working history and re-sends the whole thing each iteration, up to MAX_STEPS
// times within a single user turn.
//
// The difference from a conversation: the bulk here is TOOL RESULTS, and a
// retrieved passage is large and usually only needed for the step that asked
// for it. A conversation turn is something the user said and may refer back to;
// a stale search result is mostly ballast.
//
// Structural types rather than the SDK's, so this file keeps its "no imports"
// property — the same reason expression.ts and vector.ts have it.
// ---------------------------------------------------------------------------

export type Block = { type: string; [key: string]: unknown };
export type Message = { role: "user" | "assistant"; content: string | Block[] };

/** Placeholder left in place of a cleared result. */
export const CLEARED_NOTICE = "[earlier tool result cleared to save context]";

/**
 * Clears the CONTENT of tool results older than the most recent `keepRecent`
 * steps, leaving the blocks themselves in place.
 *
 * THE CONSTRAINT THAT MAKES THIS NON-OBVIOUS: every `tool_use` block must have
 * a matching `tool_result` with the same `tool_use_id`. You cannot simply drop
 * old results — the request becomes invalid and the API rejects it. So the
 * block stays and only its content is replaced.
 *
 * That is also why this is not the same operation as a sliding window: a window
 * removes messages, and removing half a tool_use/tool_result pair is a
 * malformed request rather than a cheaper one.
 */
export function pruneToolResults(messages: Message[], keepRecent: number): Message[] {
  if (!Number.isInteger(keepRecent) || keepRecent < 0) {
    throw new Error(`keepRecent must be a non-negative integer, got ${keepRecent}`);
  }

  // Which messages carry tool results, oldest first.
  const resultMessageIndexes = messages.flatMap((m, i) =>
    Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result") ? [i] : [],
  );
  const clearBefore = resultMessageIndexes.length - keepRecent;
  if (clearBefore <= 0) return messages;

  const toClear = new Set(resultMessageIndexes.slice(0, clearBefore));

  return messages.map((message, i) => {
    if (!toClear.has(i) || !Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((block) =>
        block.type === "tool_result"
          ? { ...block, content: CLEARED_NOTICE }
          : block,
      ),
    };
  });
}

/** Rough token size of a working history, using the same heuristic as above. */
export function estimateMessageTokens(messages: Message[]): number {
  const PER_MESSAGE_OVERHEAD = 4;
  let total = 0;
  for (const message of messages) {
    total += PER_MESSAGE_OVERHEAD;
    if (typeof message.content === "string") {
      total += estimateTokens(message.content);
      continue;
    }
    for (const block of message.content) {
      // Every string field in a block is sent, whatever it is called.
      for (const value of Object.values(block)) {
        if (typeof value === "string") total += estimateTokens(value);
      }
    }
  }
  return total;
}

export type AgentStrategy = "full" | "cached" | "pruned" | "pruned+cached";

export type AgentProjection = {
  strategy: AgentStrategy;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costNanodollars: number;
};

/**
 * Projects one agent run: `steps` iterations, each adding a tool call and a
 * result of `resultTokens`.
 *
 * Every step re-sends everything accumulated so far — the same curve as a
 * conversation, on a shorter axis, inside a single HTTP request the user
 * experiences as one question.
 */
export function projectAgentRun(
  strategy: AgentStrategy,
  steps: number,
  questionTokens: number,
  resultTokens: number,
  assistantTokens: number,
  rates: Rates,
  keepRecent = 1,
): AgentProjection {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error(`steps must be a positive integer, got ${steps}`);
  }

  const prune = strategy === "pruned" || strategy === "pruned+cached";
  const cache = strategy === "cached" || strategy === "pruned+cached";
  const clearedTokens = estimateTokens(CLEARED_NOTICE);

  /**
   * The request sent at `step`, as an ordered list of segment sizes.
   *
   * Modelled as segments rather than a single total because prefix caching is
   * positional: what matters is the first point at which this request DIFFERS
   * from the last one. A total cannot express that.
   */
  function layout(step: number): number[] {
    const segments = [questionTokens];
    for (let s = 1; s <= step - 1; s++) {
      segments.push(assistantTokens);
      const isRecent = s > step - 1 - keepRecent;
      segments.push(prune && !isRecent ? clearedTokens : resultTokens);
    }
    return segments;
  }

  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  for (let step = 1; step <= steps; step++) {
    const current = layout(step);
    const total = current.reduce((a, b) => a + b, 0);

    if (!cache || step === 1) {
      inputTokens += total;
      continue;
    }

    // Where does this request stop matching the previous one? Everything before
    // that point can be READ from cache; everything from it must be WRITTEN.
    //
    // THIS IS WHERE PRUNING AND CACHING FIGHT. Pruning does not append — it
    // EDITS an earlier segment from a full result to a placeholder. That edit
    // moves the divergence point backwards, invalidating the cache from there.
    // Appending alone would leave the whole prior request intact as a prefix.
    const previous = layout(step - 1);
    let diverge = 0;
    while (
      diverge < previous.length &&
      diverge < current.length &&
      previous[diverge] === current[diverge]
    ) {
      diverge++;
    }

    const readable = current.slice(0, diverge).reduce((a, b) => a + b, 0);
    cacheReadTokens += readable;
    cacheWriteTokens += total - readable;
  }

  const costNanodollars =
    inputTokens * rates.input +
    cacheReadTokens * rates.cacheRead +
    cacheWriteTokens * rates.cacheWrite;

  return { strategy, inputTokens, cacheReadTokens, cacheWriteTokens, costNanodollars };
}
