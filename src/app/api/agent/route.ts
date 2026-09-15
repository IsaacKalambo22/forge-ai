import { guard } from "@/lib/guard";
import { runAgent } from "@/lib/ai";
import type { StreamEvent } from "@/lib/messages";
import { observe, streamFailure } from "@/lib/observe";

const MAX_QUESTION_LENGTH = 500;

export async function POST(request: Request) {
  return observe("agent", (requestId) => handle(request, requestId));
}

async function handle(request: Request, requestId: string) {
  // Auth, rate limit and budget — before ANY work, and before the first
  // byte, so a real status code is still available (Experiment 004).
  const auth = guard(request, "agent");
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { question } = (body ?? {}) as { question?: unknown };

  if (typeof question !== "string" || question.trim() === "") {
    return Response.json({ error: "question must be a non-empty string" }, { status: 400 });
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return Response.json(
      { error: `Question too long (max ${MAX_QUESTION_LENGTH} characters)` },
      { status: 400 },
    );
  }

  // Past this line the status is committed — Experiment 004.
  const encoder = new TextEncoder();

  const responseBody = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        for await (const event of runAgent(question.trim())) {
          send(event);
        }
      } catch (error) {
        // The status line is already 200 (Experiment 004), so this error rides
        // inside the body — and it used to carry the provider's raw text with
        // it. Experiment 014 sends a correlation id instead.
        send({ type: "error", error: streamFailure(requestId, "agent", "Agent failed", error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(responseBody, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
