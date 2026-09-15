// Experiment 020 — the verification debt, as data.
//
// Seven experiments end with the same sentence: blocked on an API credential.
// Two of them are load-bearing — 018 and 019 made DECISIONS on projected
// numbers, and a cache that silently never hits costs 1.25x while looking fine.
//
// The structure here is the whole point. Each claim is split in two:
//
//   EVIDENCE     what a live call would produce. Needs a credential.
//   EVALUATOR    whether that evidence settles the claim. Pure, and testable
//                against recorded fixtures TODAY.
//
// So the judgement — the part with actual reasoning in it, and therefore the
// part that can be wrong — is verified now. Acquiring a key only supplies the
// input. That is the difference between "blocked" and "unbuilt", and it is
// worth being precise about which one a thing is.
//
// No imports, no privileges: the metrics.ts / pricing.ts / context.ts pattern.

export type Verdict =
  | { status: "pass"; detail: string }
  | { status: "fail"; detail: string }
  | { status: "unusable"; detail: string };

export type Claim = {
  id: string;
  /** The experiment whose open question this settles. */
  experiment: string;
  /** The question, as that experiment actually recorded it. */
  question: string;
  /** What has to be fetched for this to be answerable. */
  evidence: string;
  /**
   * Where the evidence comes from.
   *
   *   "sdk"  a direct Messages API call — `pnpm verify` gathers these
   *   "app"  requires the running application (a route, its stream, the DB)
   *
   * Recorded rather than left implicit, so the harness's COVERAGE is visible
   * before it is run instead of appearing as a surprise in its output.
   */
  source: "sdk" | "app";
  evaluate: (evidence: unknown) => Verdict;
};

// ---------------------------------------------------------------------------
// Small helpers. An evaluator must never throw on malformed evidence — a
// harness that crashes on a surprising response has told you nothing, and
// "unusable" is a meaningfully different answer from "fail".
// ---------------------------------------------------------------------------

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function arr(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}
const unusable = (detail: string): Verdict => ({ status: "unusable", detail });

export const CLAIMS: Claim[] = [
  {
    id: "001-content-blocks",
    experiment: "001 Basic LLM",
    question: "Is `content` really an array of typed blocks rather than a string?",
    evidence: "One Message response.",
    source: "sdk",
    evaluate(evidence) {
      const message = obj(evidence);
      if (message === null) return unusable("evidence is not an object");
      const content = arr(message.content);
      if (content === null) {
        return { status: "fail", detail: `content is ${typeof message.content}, not an array` };
      }
      const types = content.map((b) => obj(b)?.type ?? "?");
      return { status: "pass", detail: `${content.length} block(s): ${types.join(", ")}` };
    },
  },

  {
    id: "001-max-tokens-stop-reason",
    experiment: "001 Basic LLM",
    question: "Does a low `max_tokens` ceiling flip stop_reason from end_turn to max_tokens?",
    evidence: "A response deliberately truncated by a small max_tokens.",
    source: "sdk",
    evaluate(evidence) {
      const message = obj(evidence);
      if (message === null) return unusable("evidence is not an object");
      const stop = str(message.stop_reason);
      if (stop === null) return unusable("no stop_reason on the response");
      return stop === "max_tokens"
        ? { status: "pass", detail: "stop_reason = max_tokens" }
        : { status: "fail", detail: `stop_reason = ${stop}; the ceiling was not reached` };
    },
  },

  {
    id: "002-personas-change-behaviour",
    experiment: "002 Prompt Engineering",
    question: "Does a system instruction actually change the model's behaviour?",
    evidence: "Two answers to the SAME question, one under `default` and one under `terse`.",
    source: "sdk",
    evaluate(evidence) {
      const pair = obj(evidence);
      const base = str(pair?.default_answer);
      const terse = str(pair?.terse_answer);
      if (base === null || terse === null) {
        return unusable("need both default_answer and terse_answer as strings");
      }
      if (base.trim() === "" || terse.trim() === "") return unusable("an answer was empty");
      // The terse persona says "answer in one sentence, no preamble". A weaker
      // assertion than "is it good", and one that cannot pass by accident.
      if (terse.length >= base.length) {
        return {
          status: "fail",
          detail: `terse (${terse.length} chars) is not shorter than default (${base.length})`,
        };
      }
      const ratio = terse.length / base.length;
      return {
        status: "pass",
        detail: `terse is ${(ratio * 100).toFixed(0)}% the length of default ` +
          `(${terse.length} vs ${base.length} chars)`,
      };
    },
  },

  {
    id: "005-schema-conformance",
    experiment: "005 Structured Output",
    question: "Does the model actually return output matching the zod schema?",
    evidence: "One /api/analyze response.",
    source: "app",
    evaluate(evidence) {
      const response = obj(evidence);
      if (response === null) return unusable("evidence is not an object");
      if (response.parsed_output === null) {
        return { status: "fail", detail: "parsed_output was null — the output did not validate" };
      }
      const parsed = obj(response.parsed_output);
      if (parsed === null) return unusable("parsed_output is not an object");
      const missing = ["title", "topics", "open_questions"].filter((k) => !(k in parsed));
      return missing.length === 0
        ? { status: "pass", detail: `all fields present; title = ${JSON.stringify(parsed.title)}` }
        : { status: "fail", detail: `missing field(s): ${missing.join(", ")}` };
    },
  },

  {
    id: "006-tool-loop-executes",
    experiment: "006 Tool Calling",
    question: "Does the tool loop ever actually execute? (Built in 006, never run.)",
    evidence: "The NDJSON event stream from /api/chat for a question needing arithmetic.",
    source: "app",
    evaluate(evidence) {
      const events = arr(evidence);
      if (events === null) return unusable("evidence is not an array of stream events");
      const types = events.map((e) => obj(e)?.type);
      const uses = types.filter((t) => t === "tool_use").length;
      const results = types.filter((t) => t === "tool_result").length;
      if (uses === 0) return { status: "fail", detail: "the model never requested a tool" };
      if (results === 0) {
        return { status: "fail", detail: `${uses} tool_use but no tool_result — the loop did not close` };
      }
      return { status: "pass", detail: `${uses} tool_use, ${results} tool_result` };
    },
  },

  {
    id: "009-agent-loop-executes",
    experiment: "009 Agent",
    question: "Does the agent loop ever execute, and does it stop through the policy?",
    evidence: "The event stream from /api/agent.",
    source: "app",
    evaluate(evidence) {
      const events = arr(evidence);
      if (events === null) return unusable("evidence is not an array of stream events");
      const steps = events.filter((e) => obj(e)?.type === "step").length;
      const stopped = events.find((e) => obj(e)?.type === "stopped");
      if (steps === 0) return { status: "fail", detail: "no step events — the loop never ran" };
      if (stopped === undefined) {
        return { status: "fail", detail: `${steps} step(s) but no stopped event — it did not exit through decide()` };
      }
      const reason = str(obj(stopped)?.reason) ?? "?";
      // "budget" means it hit the ceiling rather than finishing — a pass for
      // "does it run", and worth seeing.
      return { status: "pass", detail: `${steps} step(s), stopped: ${reason}` };
    },
  },

  {
    id: "017-live-usage-row",
    experiment: "017 Cost Accounting",
    question: "Is a ledger row ever written from a real `usage` object, with no unpriced fields?",
    evidence: "The usage object from one Message response.",
    source: "sdk",
    evaluate(evidence) {
      const usage = obj(evidence);
      if (usage === null) return unusable("evidence is not an object");
      const input = num(usage.input_tokens);
      const output = num(usage.output_tokens);
      if (input === null || output === null) {
        return { status: "fail", detail: "input_tokens/output_tokens missing or non-numeric" };
      }
      if (!Number.isInteger(input) || !Number.isInteger(output)) {
        return { status: "fail", detail: "token counts are not integers" };
      }
      // The failure 017 built `unpricedFields()` for: a billable category this
      // project does not price makes every recorded total a lower bound.
      const known = new Set([
        "input_tokens", "output_tokens", "cache_read_input_tokens",
        "cache_creation_input_tokens", "service_tier", "server_tool_use",
        "speed", "inference_geo", "iterations", "cache_creation",
      ]);
      const unpriced = Object.keys(usage).filter(
        (k) => !known.has(k) && usage[k] !== null && usage[k] !== undefined,
      );
      return unpriced.length === 0
        ? { status: "pass", detail: `${input} in / ${output} out, all fields priced` }
        : { status: "fail", detail: `UNPRICED field(s): ${unpriced.join(", ")} — totals are a lower bound` };
    },
  },

  {
    id: "018-cache-actually-hits",
    experiment: "018 Context Management",
    question: "Does the prefix cache ever actually hit? (A cache that never hits costs 1.25x.)",
    evidence: "The usage object from the SECOND request of a conversation.",
    source: "sdk",
    evaluate(evidence) {
      const usage = obj(evidence);
      if (usage === null) return unusable("evidence is not an object");
      const read = num(usage.cache_read_input_tokens) ?? 0;
      const written = num(usage.cache_creation_input_tokens) ?? 0;
      if (read > 0) {
        return { status: "pass", detail: `${read} tokens read from cache, ${written} written` };
      }
      if (written > 0) {
        // The exact silent failure 018 warned about: the write premium is paid
        // and nothing is ever read back.
        return {
          status: "fail",
          detail: `${written} tokens WRITTEN but 0 read — paying 1.25x for nothing. ` +
            `Either the prefix is changing, or it is below the minimum cacheable size.`,
        };
      }
      return { status: "fail", detail: "no cache activity at all — cache_control may not be reaching the API" };
    },
  },

  {
    id: "019-pruning-preserves-citations",
    experiment: "019 Agent Context",
    question: "Does the agent still cite its sources when older passages are pruned?",
    evidence: "The final answer text from /api/agent, plus the source files it was given.",
    source: "app",
    evaluate(evidence) {
      const run = obj(evidence);
      const answer = str(run?.answer);
      const sources = arr(run?.sources);
      if (answer === null || sources === null) {
        return unusable("need an answer string and a sources array");
      }
      if (answer.trim() === "") return unusable("the answer was empty");
      const cited = sources.filter((s) => {
        const file = str(s);
        return file !== null && answer.includes(file);
      });
      // The predicted regression: keepRecent = 3 clears older passages, and a
      // cleared passage cannot be cited.
      return cited.length > 0
        ? { status: "pass", detail: `cited ${cited.length}/${sources.length} source(s)` }
        : {
            status: "fail",
            detail: `cited none of ${sources.length} source(s) — keepRecent may be too low`,
          };
    },
  },
];

export const CLAIM_IDS = CLAIMS.map((c) => c.id);

export function claimById(id: string): Claim | undefined {
  return CLAIMS.find((c) => c.id === id);
}

/** Claims `pnpm verify` can gather without the application running. */
export const SDK_CLAIMS = CLAIMS.filter((c) => c.source === "sdk");
/** Claims that need the app running — not yet gathered. */
export const APP_CLAIMS = CLAIMS.filter((c) => c.source === "app");
