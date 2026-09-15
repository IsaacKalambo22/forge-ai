import "server-only";

import { log, newRequestId, redactString } from "./log";
import { record } from "./telemetry";

// WHY THIS ABSTRACTION EXISTS (the rule from AGENTS.md: justify it or don't
// build it).
//
//   What problem appeared?      Five route handlers each needed an id, a timer,
//                               a log line, a telemetry record and a response
//                               header — identical in all five.
//   Why was the previous        Inline, it is ~15 lines of bookkeeping per
//   approach insufficient?      route, five times, and the one route where
//                               somebody forgets is invisible precisely because
//                               observability is what is missing from it.
//   What does it add?           One indirection between the route and its
//                               Response, and a timer that measures the handler
//                               rather than the stream (see below).
//   Why is the trade justified? The duplication is mechanical and the failure
//                               mode of getting it wrong is silent.
//
// It is deliberately NOT a framework: no middleware stack, no plugin registry,
// no context object. One function that wraps one handler.

/**
 * Times a handler, logs one structured line, records telemetry, and stamps
 * `X-Request-Id` on the response.
 *
 * IMPORTANT — what `ms` means for a streaming route. The timer stops when the
 * handler RETURNS, and `/api/chat` returns as soon as the stream is opened,
 * before the model has produced a single token. So for that route this is
 * time-to-response-start, not total duration. It is still the number that
 * matters for "did we accept the request promptly", and it is NOT the number
 * for "how long did the user wait". Measuring the latter means instrumenting
 * inside the stream. Deferred, and recorded so the figure is not misread.
 */
export async function observe(
  route: string,
  handler: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = newRequestId();
  const started = Date.now();

  try {
    const response = await handler(requestId);
    const ms = Date.now() - started;

    log({ level: response.status >= 500 ? "error" : "info",
      msg: "request", request_id: requestId, route, status: response.status, ms });
    record({ route, status: response.status, ms });

    // Response headers are immutable once constructed, so the response is
    // rebuilt. Passing `response.body` through keeps streaming intact — the
    // body is a stream, not a buffer, and is not consumed here.
    const headers = new Headers(response.headers);
    headers.set("X-Request-Id", requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    // A throw that escapes the handler would otherwise be an opaque 500 from
    // the framework with nothing tying it to the user's report.
    const ms = Date.now() - started;
    log({ level: "error", msg: "unhandled", request_id: requestId, route, status: 500, ms,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined });
    record({ route, status: 500, ms });

    return Response.json(
      { error: "Internal server error", request_id: requestId },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}

/**
 * The fix for Experiment 001's deferred debt.
 *
 * Until now every route did this:
 *
 *   return Response.json({ error: `Analysis failed: ${error.message}` }, { status: 502 });
 *
 * `error.message` is the PROVIDER's text. With a bad key it is literally
 * `401 {"type":"error","error":{"message":"invalid x-api-key"}}` — which tells
 * anyone who pokes the endpoint which vendor is behind it, and in other failure
 * modes can carry more than that. It was forwarded deliberately, because
 * without it a 401 could not be diagnosed from curl, and the README recorded
 * the debt as "log it server-side and return a correlation id instead".
 *
 * This is that. The real cause goes to the log, redacted, with the id; the
 * client gets the id and nothing else.
 *
 * The development exception is deliberate and narrow: outside production the
 * detail is ALSO returned, because the curl-driven debugging loop that this
 * project is built around depends on it. `NODE_ENV` is set by the framework,
 * not by the request, so it cannot be flipped by a caller.
 */
export function failure(
  requestId: string,
  route: string,
  publicMessage: string,
  status: number,
  error: unknown,
): Response {
  const detail = error instanceof Error ? error.message : String(error);

  log({ level: "error", msg: publicMessage, request_id: requestId, route, status,
    error: detail, stack: error instanceof Error ? error.stack : undefined });

  const body: Record<string, unknown> = { error: publicMessage, request_id: requestId };
  if (process.env.NODE_ENV !== "production") {
    // Redacted even here: a key in a dev log is still a key on a disk.
    body.detail_dev_only = redactString(detail);
  }

  return Response.json(body, { status });
}

/**
 * `failure()` for a route that has already sent its first byte.
 *
 * A streaming route cannot return a Response any more — the status line went
 * out with the first chunk (Experiment 004) — so its errors travel inside the
 * body. They leaked the provider's text exactly like the non-streaming ones
 * did, just somewhere less obvious.
 *
 * Returns the string to put in the `error` event. The real cause goes to the
 * log with the id, as everywhere else.
 */
export function streamFailure(
  requestId: string,
  route: string,
  publicMessage: string,
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);

  log({ level: "error", msg: publicMessage, request_id: requestId, route, status: 200,
    note: "failed mid-stream; HTTP status was already 200",
    error: detail, stack: error instanceof Error ? error.stack : undefined });

  return process.env.NODE_ENV !== "production"
    ? `${publicMessage} (${requestId}): ${redactString(detail)}`
    : `${publicMessage} — reference ${requestId}`;
}
