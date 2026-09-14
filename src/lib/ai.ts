// Importing this module from a Client Component is a build error. Without this
// line the SDK and every system prompt below were silently bundled into the
// browser — see experiments/002-prompt-engineering.
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { ConversationAnalysisSchema } from "./analysis";
import type { ChatMessage, StreamEvent } from "./messages";
import type { PersonaId } from "./personas";
import { MAX_TOOL_ITERATIONS, TOOL_DEFINITIONS, executeTool } from "./tools";

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

// Structured output: the model is constrained to the schema, so the result is a
// typed object rather than prose we would otherwise have to parse with regex.
// `messages.parse()` validates the response against the schema for us.
export async function analyzeConversation(messages: ChatMessage[]) {
  const response = await anthropic.messages.parse({
    model: "claude-opus-5",
    max_tokens: 1024,
    system:
      "You analyse chat transcripts. Report only what the transcript " +
      "supports. If there are no open questions, return an empty array.",
    messages: [
      {
        role: "user",
        content:
          "Analyse this conversation:\n\n" +
          messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(ConversationAnalysisSchema) },
  });

  return response;
}

// The agentic loop, written out by hand rather than using the SDK's
// toolRunner(), because the loop IS the thing being learned here. In
// production the runner is the right choice — see experiments/006-tool-calling.
//
// An async generator: it yields events as they happen, so the route can write
// them straight to the NDJSON stream without buffering the whole run.
export async function* runToolLoop(
  messages: ChatMessage[],
  persona: PersonaId = "default",
): AsyncGenerator<StreamEvent> {
  // Working history: starts as the conversation, then grows with the model's
  // tool requests and our results. These extra turns are NOT sent back to the
  // browser as conversation — they are the loop's internal scratch space.
  const working: Anthropic.MessageParam[] = [...messages];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const stream = anthropic.messages.stream({
      model: "claude-opus-5",
      max_tokens: 1024,
      system: PROMPTS[persona],
      tools: TOOL_DEFINITIONS,
      messages: working,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();

    // Anything other than "tool_use" means the model is finished talking.
    if (final.stop_reason !== "tool_use") {
      yield {
        type: "done",
        usage: final.usage,
        stop_reason: final.stop_reason,
        model: final.model,
      };
      return;
    }

    // The assistant's turn must be appended verbatim — including the tool_use
    // blocks. Their `id` is what our results are matched against.
    working.push({ role: "assistant", content: final.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of final.content) {
      if (block.type !== "tool_use") continue;

      yield { type: "tool_use", name: block.name, input: block.input };

      const result = await executeTool(block.name, block.input);

      yield {
        type: "tool_result",
        name: block.name,
        output: result.output,
        is_error: result.is_error,
      };

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.output,
        // A failed tool is reported, never dropped. The model needs to know it
        // failed so it can correct itself or explain.
        is_error: result.is_error,
      });
    }

    // ALL results go back in ONE user message. Splitting them across several
    // messages teaches the model to stop making parallel tool calls.
    working.push({ role: "user", content: toolResults });
  }

  yield {
    type: "error",
    error: `Tool loop exceeded ${MAX_TOOL_ITERATIONS} iterations`,
  };
}
