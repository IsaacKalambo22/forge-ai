// Tool implementations run on the server with the server's privileges. Their
// ARGUMENTS are written by the model, which is in turn influenced by whatever
// the user typed — so tool input is untrusted input that has taken a detour.
import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { evaluateExpression } from "./expression";
import { retrieve } from "./knowledge";

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
    name: "search_notebook",
    description:
      "Search this project's engineering notebook and return the most relevant " +
      "passages. Call this whenever the user asks about anything recorded in the " +
      "notebook — experiments, findings, lessons, measurements or decisions. " +
      "Prefer calling it more than once with different wording if the first " +
      "results do not contain the answer.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to look for, phrased as a description of the subject",
        },
      },
      required: ["query"],
    },
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

      case "search_notebook": {
        const { query } = (input ?? {}) as { query?: unknown };
        if (typeof query !== "string" || query.trim() === "") {
          return { output: "search_notebook requires a non-empty 'query' string", is_error: true };
        }
        if (query.length > 500) {
          return { output: "Query too long (max 500 characters)", is_error: true };
        }

        const results = await retrieve(query.trim(), 3);
        if (results.length === 0) {
          return { output: "No passages found.", is_error: false };
        }

        // Returned as fenced, labelled passages for the same reason as in
        // Experiment 008: this is retrieved DATA entering the conversation.
        return {
          output: results
            .map(
              ({ item, score }) =>
                `<passage source="${item.file}" heading="${item.heading}" score="${score.toFixed(3)}">\n${item.text}\n</passage>`,
            )
            .join("\n\n"),
          is_error: false,
        };
      }

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
