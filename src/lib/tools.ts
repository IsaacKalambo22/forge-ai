// Tool implementations run on the server with the server's privileges. Their
// ARGUMENTS are written by the model, which is in turn influenced by whatever
// the user typed — so tool input is untrusted input that has taken a detour.
import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { evaluateExpression } from "./expression";

// An unbounded tool loop is a runaway cost bug and a denial-of-service on
// ourselves: each iteration is a paid request, and the model decides whether
// there is another one. The ceiling is ours to set, not the model's.
export const MAX_TOOL_ITERATIONS = 5;

export type ToolResult = { output: string; is_error: boolean };

// Descriptions are prescriptive about WHEN to call, not just what it does —
// that is what the model reads to decide.
export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "get_current_time",
    description:
      "Get the current date and time in UTC. Call this whenever the user asks " +
      "what time or date it is, or asks about anything relative to now — the " +
      "model has no clock of its own.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "calculate",
    description:
      "Evaluate an arithmetic expression exactly. Call this for any arithmetic " +
      "the user asks for, rather than computing it yourself. Supports + - * / " +
      "%, parentheses, and decimals.",
    input_schema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "An arithmetic expression, e.g. \"(17 * 3) + 1.5\"",
        },
      },
      required: ["expression"],
    },
  },
];

// ---------------------------------------------------------------------------

export async function executeTool(name: string, input: unknown): Promise<ToolResult> {
  try {
    switch (name) {
      case "get_current_time":
        return { output: new Date().toISOString(), is_error: false };

      case "calculate": {
        // The model is supposed to send { expression: string }. "Supposed to"
        // is not a guarantee, so check rather than cast.
        const { expression } = (input ?? {}) as { expression?: unknown };
        if (typeof expression !== "string" || expression.trim() === "") {
          return { output: "calculate requires a non-empty 'expression' string", is_error: true };
        }
        if (expression.length > 200) {
          return { output: "Expression too long (max 200 characters)", is_error: true };
        }
        return { output: String(evaluateExpression(expression)), is_error: false };
      }

      default:
        // The model asked for a tool that does not exist. Tell it so it can
        // recover, rather than throwing and killing the whole conversation.
        return { output: `Unknown tool: ${name}`, is_error: true };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return { output: detail, is_error: true };
  }
}
