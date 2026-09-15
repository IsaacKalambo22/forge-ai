// Structured logging. No imports, no privileges — so the redaction below is
// exhaustively testable, which for this module is the whole point.
//
// "Structured" means one JSON object per line rather than a prose sentence.
// `console.log("chat took", ms, "ms")` is readable by a human watching one
// terminal and useless to everything else: you cannot filter it, count it, or
// take a percentile of it. A JSON line can be queried by a machine and still
// read by a person.
//
// The danger this module exists to contain: logs get shipped, retained, and
// read by people who are not you. **A log that captures a secret has moved that
// secret somewhere with weaker access control than the place it came from.**
// Redaction is therefore not a nicety here — it is the reason this is a module
// with tests rather than a call to console.log.

/** Field names whose VALUES are never safe to log, matched case-insensitively. */
const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|password|passwd|secret|token|session|app_secret|anthropic_api_key)$/i;

/** Shapes that are secrets wherever they appear, including inside a message. */
const SENSITIVE_VALUE: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,        // Anthropic keys
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, // bearer tokens in a header or error string
];

export const REDACTED = "[redacted]";

/** Redacts secret-shaped substrings inside a single string. */
export function redactString(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_VALUE) out = out.replace(pattern, REDACTED);
  return out;
}

/**
 * Recursively redacts a value by KEY NAME and by VALUE SHAPE.
 *
 * Both are needed, and neither is sufficient. Key-name matching misses a key
 * pasted into a free-text error message — which is exactly how this project's
 * provider errors arrive. Value-shape matching misses a secret that does not
 * look like one, such as a session cookie of arbitrary bytes.
 */
export function redact(value: unknown, depth = 0): unknown {
  // A cycle or a pathological object must not hang the logger. Logging is
  // supposed to be the thing that still works when everything else is broken.
  if (depth > 6) return "[too deep]";

  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export type LogRecord = {
  level: "info" | "warn" | "error";
  msg: string;
  /** The correlation id. Ties this line to the response the user was holding. */
  request_id?: string;
  route?: string;
  status?: number;
  ms?: number;
  [key: string]: unknown;
};

/** Serialises a record to one redacted JSON line. Pure — the sink is elsewhere. */
export function formatLine(record: LogRecord, now: number): string {
  const redacted = redact({ ...record, ts: new Date(now).toISOString() });
  return JSON.stringify(redacted);
}

/**
 * A short correlation id.
 *
 * Its job: the user sees an opaque id, the log holds the real cause, and one
 * grep connects them. That is what lets the server stop explaining its
 * failures to the client — see Experiment 001's deferred provider-leak debt,
 * closed in Experiment 014.
 *
 * Not a UUID because it is read aloud, pasted into chat, and screenshotted.
 * Not a secret, so `Math.random` is adequate; it only has to be unlikely to
 * collide inside one log file.
 */
export function newRequestId(): string {
  // Padded before slicing: Math.random() occasionally produces a short base-36
  // string, and an empty correlation id fails silently — the log line and the
  // user's error page simply stop matching, which is the one thing this value
  // exists to prevent.
  return (Math.random().toString(36).slice(2) + "00000000").slice(0, 8);
}

export function log(record: LogRecord): void {
  const line = formatLine(record, Date.now());
  if (record.level === "error") console.error(line);
  else console.log(line);
}
