import { runAgent } from "@/lib/ai";
import type { StreamEvent } from "@/lib/messages";

const MAX_QUESTION_LENGTH = 500;

export async function POST(request: Request) {
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
        console.error("runAgent failed:", error);
        const detail = error instanceof Error ? error.message : "Unknown error";
        send({ type: "error", error: `Agent failed: ${detail}` });
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
