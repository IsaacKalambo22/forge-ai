// The agent's stopping policy, as a pure function of observable state.
//
// No imports, no privileges — the expression.ts / vector.ts / chunk.ts pattern.
// An agent loop is the one piece of this project that can spend money without
// anyone watching, so the rules for ending it are worth being able to test
// exhaustively rather than reasoning about inside an async generator.

export type AgentStep = {
  /** Tools called in this step, as name + serialised input. */
  calls: string[];
  /** Did the model stop asking for tools? */
  finished: boolean;
};

export type AgentDecision =
  | { action: "continue" }
  | { action: "stop"; reason: "done" }
  | { action: "stop"; reason: "budget" }
  | { action: "stop"; reason: "no_progress" };

export const MAX_STEPS = 6;

/** How many identical repetitions of the same call set count as a stuck loop. */
export const REPEAT_LIMIT = 2;

/**
 * Decide what to do after `steps` have completed.
 *
 * Three ways to stop, and only the first is the happy one:
 *  - done        the model stopped asking for tools
 *  - budget      we hit the step ceiling; the model would have kept going
 *  - no_progress the model repeated the same call set, which it can do forever
 */
export function decide(steps: AgentStep[]): AgentDecision {
  const last = steps[steps.length - 1];

  if (last === undefined) return { action: "continue" };
  if (last.finished) return { action: "stop", reason: "done" };

  // A model that asks for the same thing twice has learned nothing from the
  // answer, and will usually keep doing it until the budget runs out. Stopping
  // early turns a slow expensive failure into a fast cheap one.
  const signature = fingerprint(last);
  let repeats = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (fingerprint(steps[i]) !== signature) break;
    repeats++;
  }
  if (repeats >= REPEAT_LIMIT) return { action: "stop", reason: "no_progress" };

  if (steps.length >= MAX_STEPS) return { action: "stop", reason: "budget" };

  return { action: "continue" };
}

function fingerprint(step: AgentStep): string {
  // Order-independent: asking for A then B is the same request as B then A.
  return [...step.calls].sort().join("|");
}

export function explain(reason: "done" | "budget" | "no_progress"): string {
  switch (reason) {
    case "done":
      return "finished";
    case "budget":
      return `stopped after ${MAX_STEPS} steps (budget)`;
    case "no_progress":
      return "stopped: repeated the same tool calls without making progress";
  }
}
