import { askClaude } from "@/lib/ai";

export async function POST(request: Request) {
  // Experiment 001 found that a malformed or `null` body throws *before* the
  // validation below ever runs, producing a 500 with an empty response body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = (body as { message?: unknown })?.message;

  if (typeof message !== "string" || message.trim() === "") {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  try {
    const response = await askClaude(message);
    return Response.json(response);
  } catch (error) {
    // Log the real error server-side; send the client a safe summary.
    console.error("askClaude failed:", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: `Model request failed: ${detail}` }, { status: 502 });
  }
}
