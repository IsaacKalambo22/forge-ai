// Client-safe: ids and labels only, no prompt text, no SDK import.
// The browser needs to know WHICH personas exist in order to offer a menu.
// It does not need — and must not receive — what any of them say.
export const PERSONA_IDS = ["default", "terse", "engineer"] as const;

export type PersonaId = (typeof PERSONA_IDS)[number];

export function isPersonaId(value: unknown): value is PersonaId {
  return (PERSONA_IDS as readonly unknown[]).includes(value);
}
