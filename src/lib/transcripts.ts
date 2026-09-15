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
  /**
   * Experiment 016. NULL only for conversations created before owners existed —
   * see the migration note in db.ts. `readable()` treats NULL as "not yours".
   */
  owner_id: string | null;
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
  ownerId: string,
  now: number,
): Conversation {
  const conversation: Conversation = {
    id: newConversationId(), created_at: now, persona, owner_id: ownerId,
  };
  database
    .prepare("INSERT INTO conversations (id, created_at, persona, owner_id) VALUES (?, ?, ?, ?)")
    .run(conversation.id, now, persona, ownerId);
  return conversation;
}

/**
 * The authorization check. Returns the conversation only if `userId` owns it.
 *
 * WHY THIS RETURNS null RATHER THAN THROWING A "FORBIDDEN"
 *
 * The routes turn this into a **404, never a 403**. A 403 says "this exists,
 * but not for you" — which confirms the id is real. Conversation ids are
 * unguessable, so that confirmation is the only thing an attacker with a
 * stolen or leaked id could not already work out, and handing it over turns a
 * half-leak into a whole one. To someone who does not own it, the conversation
 * is indistinguishable from one that was never created.
 *
 * A NULL owner (a pre-016 conversation) is nobody's, so it is nobody's to read.
 * The alternative — assigning those rows to whoever asks first — would be
 * inventing ownership.
 */
export function readable(
  database: DatabaseSync,
  id: string,
  userId: string,
): Conversation | null {
  const conversation = getConversation(database, id);
  if (conversation === null) return null;
  if (conversation.owner_id === null) return null;
  if (conversation.owner_id !== userId) return null;
  return conversation;
}

/** Every conversation belonging to one user, newest first. */
export function listByOwner(database: DatabaseSync, userId: string): Conversation[] {
  return database
    .prepare("SELECT * FROM conversations WHERE owner_id = ? ORDER BY created_at DESC")
    .all(userId) as Conversation[];
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
  create: (persona: PersonaId, ownerId: string) =>
    createConversation(db(), persona, ownerId, Date.now()),
  /** Authorized lookup — null when it does not exist OR is not yours. */
  readable: (id: string, userId: string) => readable(db(), id, userId),
  listByOwner: (userId: string) => listByOwner(db(), userId),
  read: (id: string) => getTranscript(db(), id),
  append: (id: string, role: "user" | "assistant", content: string) =>
    appendTurn(db(), id, role, content, Date.now()),
};
