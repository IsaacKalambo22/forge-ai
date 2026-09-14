import { searchLessons } from "@/lib/search";

const MAX_QUERY_LENGTH = 500;

export async function POST(request: Request) {
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
    console.error("searchLessons failed:", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: `Search failed: ${detail}` }, { status: 500 });
  }
}
