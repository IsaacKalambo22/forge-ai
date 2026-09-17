import { guard } from "@/lib/guard";
import { searchLessons } from "@/lib/search";
import { observe, failure } from "@/lib/observe";

const MAX_QUERY_LENGTH = 500;

export async function POST(request: Request) {
  return observe("search", (requestId) => handle(request, requestId));
}

async function handle(request: Request, requestId: string) {
  // Auth, rate limit and budget — before ANY work, and before the first
  // byte, so a real status code is still available (Experiment 004).
  const auth = guard(request, "search", requestId);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { query } = (body ?? {}) as { query?: unknown };

  if (typeof query !== "string" || query.trim() === "") {
    return Response.json({ error: "query must be a non-empty string" }, { status: 400 });
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return Response.json(
      { error: `Query too long (max ${MAX_QUERY_LENGTH} characters)` },
      { status: 400 },
    );
  }

  // No streaming here, so real status codes are available (Experiment 004).
  try {
    const started = Date.now();
    const results = await searchLessons(query.trim());
    return Response.json({ results, ms: Date.now() - started });
  } catch (error) {
    return failure(requestId, "search", "Search failed", 500, error);
  }
}
