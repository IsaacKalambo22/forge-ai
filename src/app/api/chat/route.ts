import { guard } from "@/lib/guard";
import { runToolLoop } from "@/lib/ai";
import { MAX_MESSAGE_LENGTH, type StreamEvent } from "@/lib/messages";
import { isPersonaId } from "@/lib/personas";
import { observe, streamFailure } from "@/lib/observe";
import { transcripts, TranscriptError } from "@/lib/transcripts";

export async function POST(request: Request) {
  return observe("chat", (requestId) => handle(request, requestId));
}

// Experiment 015 changed this route's contract.
//
//   before   { messages: [ …the entire conversation… ], persona }
//   after    { conversation_id?, message, persona? }
//
// Experiment 003 recorded why: client-held history can be forged, and a forged
// ASSISTANT turn is the client writing into the model's context. There is now
// no parameter through which a caller can supply one — not because it is
// validated away, but because it does not exist.
async function handle(request: Request, requestId: string) {
  const denied = guard(request, "chat");
  if (denied !== null) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { conversation_id: conversationId, message, persona } = (body ?? {}) as {
    conversation_id?: unknown;
    message?: unknown;
    persona?: unknown;
  };

  if (typeof message !== "string" || message.trim() === "") {
    return Response.json({ error: "message must be a non-empty string" }, { status: 400 });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return Response.json(
      { error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` },
      { status: 400 },
    );
  }

  if (persona !== undefined && !isPersonaId(persona)) {
    return Response.json({ error: "Unknown persona" }, { status: 400 });
  }

  if (conversationId !== undefined && typeof conversationId !== "string") {
    return Response.json({ error: "conversation_id must be a string" }, { status: 400 });
  }

  // Resolve the conversation before anything is written.
  //
  // An unknown id is a 404 rather than a silent new conversation: quietly
  // starting a fresh one would make a client bug — a typo'd or dropped id —
  // look like the model forgetting, which is a miserable thing to debug.
  let conversation;
  if (conversationId === undefined) {
    conversation = transcripts.create(isPersonaId(persona) ? persona : "default");
  } else {
    const existing = transcripts.get(conversationId);
    if (existing === null) {
      return Response.json({ error: "Unknown conversation" }, { status: 404 });
    }
    conversation = existing;
  }

  // The persona belongs to the CONVERSATION, fixed when it was created. Letting
  // it change per request would mean a stored transcript whose turns were each
  // produced under instructions nobody recorded — the history would no longer
  // explain itself. Changing persona starts a new conversation.
  const activePersona = conversation.persona;

  // Record the user's turn before calling the model. If the model call fails,
  // the question is still in the transcript, which is the honest record: the
  // user did ask it.
  try {
    transcripts.append(conversation.id, "user", message.trim());
  } catch (error) {
    if (error instanceof TranscriptError) {
      // Includes the MAX_TURNS cap, now enforced where it cannot be bypassed.
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  // The full history, read back from the server's own record — not from
  // anything the client sent.
  const history = transcripts.read(conversation.id);

  // Past this line the status is committed — Experiment 004.
  const encoder = new TextEncoder();

  const responseBody = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      // First, so a client that disconnects mid-stream still knows which
      // conversation to resume.
      send({ type: "conversation", id: conversation.id });

      let answer = "";

      try {
        for await (const event of runToolLoop(history, activePersona)) {
          if (event.type === "text") answer += event.text;
          send(event);
        }
      } catch (error) {
        send({ type: "error", error: streamFailure(requestId, "chat", "Model request failed", error) });
      } finally {
        // Record whatever the model actually produced, including a partial
        // reply from a failed turn — the tokens were billed and the user saw
        // the text, so a transcript omitting it would not match what happened.
        if (answer !== "") {
          try {
            transcripts.append(conversation.id, "assistant", answer);
          } catch (error) {
            // Never let a bookkeeping failure escape into an already-open
            // stream; the reply itself was delivered.
            streamFailure(requestId, "chat", "Failed to record assistant turn", error);
          }
        }
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
