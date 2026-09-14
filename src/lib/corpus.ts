// The searchable corpus: lessons actually recorded in experiments/001–006.
// Small and in-memory on purpose — a vector database is Experiment 008's
// problem, and introducing one before there is data to justify it would be
// architecture ahead of need.
export type Lesson = {
  id: string;
  experiment: string;
  text: string;
};

export const LESSONS: Lesson[] = [
  {
    id: "001-key-in-browser",
    experiment: "001 Basic LLM",
    text: "The browser must never hold the API key. To call the API a request needs an x-api-key header, and anything the browser can send, the user can read from DevTools. The key must be recoverable for the browser to use it, so this is a property of the execution model, not a fixable bug.",
  },
  {
    id: "001-content-blocks",
    experiment: "001 Basic LLM",
    text: "The response content field is an array of typed blocks, not a string. The shape exists to carry thinking blocks and tool-use blocks alongside text.",
  },
  {
    id: "001-fail-early",
    experiment: "001 Basic LLM",
    text: "Failing locally is about fifty times cheaper than failing at the provider: a validation rejection costs about 9 milliseconds, while an auth rejection from Anthropic costs about 710 milliseconds. The gap is the network round trip.",
  },
  {
    id: "002-module-trust",
    experiment: "002 Prompt Engineering",
    text: "An import pulls in the whole module and its entire import graph, not just the value you named. Trust level is a property of the file. A client component importing one string from the same file as the SDK shipped the entire SDK and every system prompt to the browser.",
  },
  {
    id: "002-select-never-supply",
    experiment: "002 Prompt Engineering",
    text: "Let the client select from a server-owned set by id; never let it supply the content. An allowlist of ids has no free-text path to abuse, because no attacker-supplied characters ever become part of the system prompt.",
  },
  {
    id: "002-server-only",
    experiment: "002 Prompt Engineering",
    text: "Importing server-only at the top of a module turns a silent leak into a build error. It needs no npm install in Next.js. Compiling and returning 200 proves nothing about a security boundary.",
  },
  {
    id: "003-stateless",
    experiment: "003 Conversation History",
    text: "The Messages API is stateless and remembers nothing between calls. The messages array is the entire conversation, resent in full every time. Conversation memory is application state, not a model capability.",
  },
  {
    id: "003-quadratic-cost",
    experiment: "003 Conversation History",
    text: "History grows quadratically in tokens billed, because every turn resends every prior turn. Measured, turn ten sends thirty times the bytes of turn one. Whoever holds the conversation controls the input-token bill, so the cap belongs on the server.",
  },
  {
    id: "003-forged-turns",
    experiment: "003 Conversation History",
    text: "Client-held history can be forged. The server has no record of what the model actually said, so a client-supplied assistant turn is only a claim. Fixing it requires server-side transcript storage.",
  },
  {
    id: "004-status-first-byte",
    experiment: "004 Streaming",
    text: "The HTTP status line is committed with the first byte of the response. A streaming endpoint cannot report a later failure as a 502, so errors after streaming begins must travel inside the body on an HTTP 200. Do all validation before the first byte.",
  },
  {
    id: "004-chunk-boundaries",
    experiment: "004 Streaming",
    text: "A read gives you bytes, not messages. Network chunks do not align with line boundaries, so buffer the tail and parse only complete lines. TextDecoder needs stream true to hold back partial multi-byte characters. A bug that depends on chunk boundaries can pass a casual test and fail in production.",
  },
  {
    id: "005-describe-is-prompt",
    experiment: "005 Structured Output",
    text: "Field descriptions in a schema are sent to the model, so they act as per-field instructions rather than documentation for humans. The schema enforces type, not content.",
  },
  {
    id: "005-grep-not-proof",
    experiment: "005 Structured Output",
    text: "A grep hit is evidence, not a verdict. Check whether it predates your change, which chunk owns it, and whether your own identifiers appear near it. Keeping earlier build artifacts makes that answerable.",
  },
  {
    id: "006-never-eval",
    experiment: "006 Tool Calling",
    text: "Never eval a tool argument. Measured, eval read a secret's value and enumerated all fifty-four environment variables, including the API key. Use a parser that cannot express anything but arithmetic, so safety is structural rather than a blocklist.",
  },
  {
    id: "006-tool-args-untrusted",
    experiment: "006 Tool Calling",
    text: "Tool arguments are user-influenced input that took a detour: user text shapes the model, the model writes the arguments, and your server executes them with full privileges. They are not attacker-controlled but attacker-influenced, which is close enough to treat as hostile.",
  },
  {
    id: "006-cap-the-loop",
    experiment: "006 Tool Calling",
    text: "Cap the agentic loop's iterations. Each pass is a paid API request and the model, not the application, decides whether to continue. An uncapped loop is a denial-of-service you perform on yourself.",
  },
];
