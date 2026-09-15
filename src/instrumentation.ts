// Runs once when a server instance starts. Experiment 025.
//
// Before this, the notebook index was built on the FIRST REQUEST — so whoever
// arrived first after a deploy paid for it. With a warm cache that is 71ms and
// invisible; with a cold one it was 196.8 seconds (Experiment 024), and they
// got a 503 rather than an answer.
//
// CRITICAL: `register()` must COMPLETE before the server accepts requests, so
// this must not await the build. Awaiting it would move a three-minute wait from
// the first request to startup itself — strictly worse, because a server that
// has not finished booting cannot even tell you why.
//
// Fire-and-forget is the whole point: the build starts now, and /api/ask keeps
// answering 503 + Retry-After until it finishes.
export async function register(): Promise<void> {
  // `register` also runs in the edge runtime, where `node:fs` does not exist.
  // knowledge.ts reads the notebook from disk, so guard the import itself —
  // a top-level import would break the edge bundle whether or not it is called.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { warmIndex } = await import("./lib/knowledge");
  warmIndex();
}
