// Importing this module from a Client Component is a build error. Without this
// line the SDK and every system prompt below were silently bundled into the
// browser — see experiments/002-prompt-engineering.
import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { ChatMessage } from "./messages";
import type { PersonaId } from "./personas";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// The prompt TEXT lives only here. The client may SELECT a persona by id;
// it can never SUPPLY the text.
const PROMPTS: Record<PersonaId, string> = {
  default: "You are a helpful assistant.",
  terse:
    "You are a terse assistant. Answer in one sentence. No preamble, no " +
    "restating the question, no closing offer to help further.",
  engineer:
    "You are a senior software engineer explaining to a junior engineer. " +
    "Always state WHAT something is, WHY it exists, and WHAT problem it " +
    "solves. Prefer concrete examples over abstractions.",
};

// `messages` is the ENTIRE conversation, not just the newest turn. The API is
// stateless: it remembers nothing between calls, so context is something this
// application rebuilds and resends every single time.
// Streaming counterpart of askClaude(). Returns the SDK's stream object rather
// than a promise: events arrive over time, and the request is still in flight
// when this function returns.
export function streamClaude(
  messages: ChatMessage[],
  persona: PersonaId = "default",
) {
  return anthropic.messages.stream({
    model: "claude-opus-5",
    // Deliberately low for Experiment 001's open question Q7.
    max_tokens: 1024,
    system: PROMPTS[persona],
    messages,
  });
}

export async function askClaude(
  messages: ChatMessage[],
  persona: PersonaId = "default",
) {
  const response = await anthropic.messages.create({
    model: "claude-opus-5",
    // Deliberately low for Experiment 001's open question Q7: a small ceiling
    // makes `stop_reason` flip from "end_turn" to "max_tokens" observable.
    max_tokens: 1024,
    system: PROMPTS[persona],
    messages,
  });

  return response;
}
