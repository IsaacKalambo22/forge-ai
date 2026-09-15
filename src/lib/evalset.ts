// Experiment 013 — the labelled query set.
//
// This file is the experiment. The metrics are arithmetic; the LABELS are the
// judgement, and they are the part that can be wrong in a way no test catches.
// Three rules were followed while writing them:
//
//   1. The query is phrased the way someone would actually ask it, NOT by
//      copying words out of the lesson. A query built from the passage's own
//      vocabulary measures nothing — it tests string overlap and flatters the
//      retriever.
//   2. `relevant` lists every lesson that genuinely answers the query, even
//      when that makes the score worse.
//   3. Labels were written BEFORE the retriever was ever run against them.
//      Adjusting labels after seeing the output is how a benchmark becomes a
//      mirror.
//
// `hard` marks queries deliberately written with near-zero word overlap with
// their answer. They are where a dense retriever should beat keyword search —
// and where, if it fails, the failure is informative rather than embarrassing.
export type EvalQuery = {
  query: string;
  /** Lesson ids from corpus.ts that genuinely answer the query. */
  relevant: string[];
  hard?: boolean;
};

export const EVAL_QUERIES: EvalQuery[] = [
  {
    query: "Why can't I just put my API key in the React component?",
    relevant: ["001-key-in-browser"],
  },
  {
    query: "I got back an object instead of a string and can't print the reply",
    relevant: ["001-content-blocks"],
    hard: true,
  },
  {
    query: "Is checking the input myself worth it before calling the model?",
    relevant: ["001-fail-early"],
    hard: true,
  },
  {
    query: "Why did my browser bundle suddenly balloon after adding one import?",
    relevant: ["002-module-trust"],
    hard: true,
  },
  {
    query: "Should I let users write their own system prompt?",
    relevant: ["002-select-never-supply"],
  },
  {
    query: "I want the compiler to stop me shipping backend code to the front end",
    relevant: ["002-server-only"],
    hard: true,
  },
  {
    query: "Does the API remember what we talked about last time?",
    relevant: ["003-stateless"],
    hard: true,
  },
  {
    query: "Why does my bill grow so fast in long conversations?",
    relevant: ["003-quadratic-cost"],
  },
  {
    query: "Could someone fake a previous reply in the transcript they send me?",
    relevant: ["003-forged-turns"],
  },
  {
    query: "I can't send an error status once the response has started",
    relevant: ["004-status-first-byte"],
  },
  {
    query: "My JSON parsing fails at random while reading the stream",
    relevant: ["004-chunk-boundaries"],
  },
  {
    query: "Does the model actually see the notes I put on each field?",
    relevant: ["005-describe-is-prompt"],
  },
  {
    query: "I found the string in a build file — does that prove it leaked?",
    relevant: ["005-grep-not-proof"],
  },
  {
    query: "Is it safe to run the expression the model produced?",
    // Two lessons genuinely answer this: the specific rule and the general
    // principle behind it. Labelling only one would make a correct retrieval
    // look like a miss.
    relevant: ["006-never-eval", "006-tool-args-untrusted"],
  },
  {
    query: "How much should I trust the arguments the model generated?",
    relevant: ["006-tool-args-untrusted"],
  },
  {
    query: "My agent keeps going round and round and won't stop",
    relevant: ["006-cap-the-loop"],
    hard: true,
  },
];
