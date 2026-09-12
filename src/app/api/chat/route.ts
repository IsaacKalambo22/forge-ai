import { askClaude } from "@/lib/ai";

export async function POST(request: Request) {
  const body = await request.json();
  const message = body.message;

  if (typeof message !== "string" || message.trim() === "") {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  const response = await askClaude(message);

  return Response.json(response);
}
