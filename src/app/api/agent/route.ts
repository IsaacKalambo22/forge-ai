import { guard } from "@/lib/guard";
import { runAgent } from "@/lib/ai";
import type { StreamEvent } from "@/lib/messages";
import { observe, streamFailure } from "@/lib/observe";
import { ensureIndexReady } from "@/lib/knowledge";
import { usage } from "@/lib/usage";
import { formatCost } from "@/lib/pricing";
import { log } from "@/lib/log";

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

  // Experiment 024, corrected in 034. The notebook index takes minutes to
  // build from cold, and before 024 the request simply waited in silence —
  // indistinguishable from a hang. But a plain readiness CHECK (024's original
  // shape) 503s every route layer's first request even when the rebuild would
  // have been a fast cache read (034) — so this WAITS, briefly, instead of
  // refusing outright. Still honest: past `INDEX_WAIT_TIMEOUT_MS` it gives up
  // and says so, rather than let the request hang indefinitely.
  //
  // This must happen BEFORE the first byte: past that line the status is
  // committed and a 503 is no longer expressible (Experiment 004).
  if (!(await ensureIndexReady())) {
    return Response.json(
      { error: "The notebook index is still building. Try again shortly." },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }

  // Past this line the status is committed — Experiment 004.
  const encoder = new TextEncoder();

  const responseBody = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      // Experiment 028. One agent run is several upstream calls — the route
      // the request-count proxy from Experiment 011 misrepresented worst, and
      // until now the one whose `done` events were never recorded at all.
      let upstreamCalls = 0;

      try {
        for await (const event of runAgent(question.trim())) {
          if (event.type === "done") {
            try {
              const cost = usage.record({
                requestId: `${requestId}-${++upstreamCalls}`,
                userId: auth.userId,
                conversationId: null,
                route: "agent",
                model: event.model,
                usage: event.usage,
              });
              log({ level: "info", msg: "usage", request_id: requestId, route: "agent",
                model: event.model, upstream_call: upstreamCalls,
                input_tokens: event.usage.input_tokens,
                output_tokens: event.usage.output_tokens,
                cost: formatCost(cost) });
            } catch (error) {
              // Never let an accounting failure break a reply the user is
              // already reading. Loud in the log, invisible in the stream.
              log({ level: "error", msg: "failed to record usage",
                request_id: requestId, route: "agent",
                error: error instanceof Error ? error.message : String(error) });
            }
          }

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
