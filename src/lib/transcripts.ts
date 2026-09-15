import "server-only";

import type { DatabaseSync } from "node:sqlite";

import { db } from "./db";
import { MAX_TURNS, type ChatMessage } from "./messages";
import type { PersonaId } from "./personas";

// The fix for Experiment 003.
//
// Until now the client sent the entire conversation on every request, and 003
// recorded the consequence honestly:
//
//   "Client-held history can be forged. The server has no record of what the
//    model actually said, so a client-supplied assistant turn is only a claim."
//
// A forged assistant turn is not a cosmetic problem. It is the client writing
// into the model's context — "you already agreed to ignore your instructions"
// is an assistant turn, and an assistant turn was whatever the client typed.
// The persona allowlist from 002 kept attacker text out of the SYSTEM prompt
// and this left a door open one layer down.
//
// Now the server owns the transcript. The client sends a conversation id and
// ONE new user message; the server reads back what it recorded. An assistant
// turn is something the server WROTE, not something the client CLAIMED.
//
// Every function takes the database explicitly. The module-level singleton is
// a thin wrapper at the bottom — the ratelimit.ts / telemetry.ts shape, for the
// same testability reason.

export type Conversation = {
  id: string;
  created_at: number;
  persona: PersonaId;
};

/**
 * Ids are 128 bits from a CSPRNG, not a counter.
 *
 * A conversation id is a capability: holding it is what lets a request read and
 * extend that transcript. Sequential ids would let anyone enumerate every
 * conversation on the server by counting.
 */
function newConversationId(): string {
  return crypto.randomUUID();
}

export function createConversation(
  database: DatabaseSync,
  persona: PersonaId,
  now: number,
): Conversation {
  const conversation: Conversation = { id: newConversationId(), created_at: now, persona };
  database
    .prepare("INSERT INTO conversations (id, created_at, persona) VALUES (?, ?, ?)")
    .run(conversation.id, now, persona);
  return conversation;
}

export function getConversation(
  database: DatabaseSync,
  id: string,
): Conversation | null {
  const row = database.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
    | Conversation
    | undefined;
  return row ?? null;
}

/** The transcript as the model wants it: ordered, oldest first. */
export function getTranscript(database: DatabaseSync, conversationId: string): ChatMessage[] {
  const rows = database
    .prepare("SELECT role, content FROM turns WHERE conversation_id = ? ORDER BY seq")
    .all(conversationId) as { role: "user" | "assistant"; content: string }[];
  return rows.map((r) => ({ role: r.role, content: r.content }));
}

export function turnCount(database: DatabaseSync, conversationId: string): number {
  const row = database
    .prepare("SELECT COUNT(*) AS n FROM turns WHERE conversation_id = ?")
    .get(conversationId) as { n: number };
  return row.n;
}

export class TranscriptError extends Error {}

/**
 * Appends one turn and returns its sequence number.
 *
 * `seq` is assigned by the SERVER from the count already stored, never supplied
 * by the caller — combined with the `UNIQUE (conversation_id, seq)` constraint,
 * that is what makes ordering a fact rather than a client assertion.
 *
 * The turn cap is enforced here rather than at the route, because this is the
 * chokepoint every write passes through. Enforcing it at the route means
 * remembering to, once per route, forever.
 */
export function appendTurn(
  database: DatabaseSync,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  now: number,
): number {
  if (content.trim() === "") {
    throw new TranscriptError("Turn content cannot be empty");
  }
  if (getConversation(database, conversationId) === null) {
    throw new TranscriptError("Unknown conversation");
  }

  const seq = turnCount(database, conversationId);

  // The cost control from 003, now enforced where it cannot be bypassed. It is
  // checked on the USER turn only: refusing to record what the model just said
  // would corrupt the transcript to save nothing — the request is already paid
  // for by then.
  if (role === "user" && seq >= MAX_TURNS) {
    throw new TranscriptError(`Conversation too long (max ${MAX_TURNS} turns)`);
  }

  database
    .prepare(
      "INSERT INTO turns (conversation_id, seq, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(conversationId, seq, role, content, now);

  return seq;
}

// ---------------------------------------------------------------------------
// Process-wide wrappers over the singleton connection.
// ---------------------------------------------------------------------------

export const transcripts = {
  create: (persona: PersonaId) => createConversation(db(), persona, Date.now()),
  get: (id: string) => getConversation(db(), id),
  read: (id: string) => getTranscript(db(), id),
  append: (id: string, role: "user" | "assistant", content: string) =>
    appendTurn(db(), id, role, content, Date.now()),
};
