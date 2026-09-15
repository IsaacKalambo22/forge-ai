// Experiment 014. Redaction is the reason log.ts is a tested module instead of
// a console.log. A logger that captures a secret has copied it somewhere with
// weaker access control than where it came from — and logs get shipped,
// retained, and read by people who are not you.
import { redact, redactString, formatLine, newRequestId, REDACTED } from "@/lib/log";
import { group, ok, eq } from "./harness.mts";

const has = (s: string, needle: string) => s.includes(needle);

group("log — redaction by key name");
eq("authorization", redact({ authorization: "Bearer hunter2" }), { authorization: REDACTED });
eq("cookie", redact({ cookie: "forge_session=abc.def" }), { cookie: REDACTED });
eq("x-api-key", redact({ "x-api-key": "sk-ant-123" }), { "x-api-key": REDACTED });
eq("case-insensitive", redact({ Authorization: "x", COOKIE: "y" }),
  { Authorization: REDACTED, COOKIE: REDACTED });
eq("api_key and apiKey spellings", redact({ api_key: "a", apiKey: "b", "api-key": "c" }),
  { api_key: REDACTED, apiKey: REDACTED, "api-key": REDACTED });
eq("innocent keys survive", redact({ route: "chat", ms: 12, status: 200 }),
  { route: "chat", ms: 12, status: 200 });

group("log — redaction by value shape");
ok("an Anthropic key anywhere in a string",
  !has(redactString("failed with key sk-ant-api03-AbC_123-xyz end"), "sk-ant-api03"));
ok("a bearer token in a string",
  !has(redactString("header was Bearer eyJhbGciOi.abc"), "eyJhbGciOi"));
ok("surrounding text is preserved",
  has(redactString("failed with key sk-ant-abc end"), "failed with key") &&
  has(redactString("failed with key sk-ant-abc end"), "end"));
ok("every occurrence, not just the first",
  redactString("sk-ant-aaa and sk-ant-bbb").split(REDACTED).length === 3,
  redactString("sk-ant-aaa and sk-ant-bbb"));

group("log — both mechanisms are needed");
// Key-name matching alone misses a secret pasted into free text. Value-shape
// matching alone misses a secret that does not look like one. This is the real
// case: the provider's 401 text, which THIS project forwarded to the browser
// until Experiment 014.
const providerError = {
  msg: 'AuthenticationError: 401 {"type":"error","error":{"message":"invalid x-api-key sk-ant-api03-LEAKED"}}',
  headers: { authorization: "Bearer app-secret-value" },
};
const safe = JSON.stringify(redact(providerError));
ok("the key inside the message is gone", !has(safe, "sk-ant-api03-LEAKED"), safe.slice(0, 80));
ok("the header value is gone", !has(safe, "app-secret-value"));
ok("the diagnostic information survives", has(safe, "invalid x-api-key") && has(safe, "401"));

group("log — nesting and hostile shapes");
ok("nested objects are walked",
  !has(JSON.stringify(redact({ a: { b: { c: { cookie: "secret" } } } })), "secret"));
ok("arrays are walked",
  !has(JSON.stringify(redact({ items: [{ token: "secret" }] })), "secret"));
ok("a cycle terminates instead of hanging", (() => {
  const cyclic: Record<string, unknown> = { name: "loop" };
  cyclic.self = cyclic;
  return JSON.stringify(redact(cyclic)).includes("[too deep]");
})());
eq("primitives pass through", redact({ n: 1, b: true, z: null }), { n: 1, b: true, z: null });

group("log — formatLine");
const line = formatLine(
  { level: "error", msg: "boom", request_id: "abc123", route: "chat", status: 502, ms: 41 },
  Date.UTC(2026, 8, 15, 12, 0, 0),
);
const parsed = JSON.parse(line) as Record<string, unknown>;
ok("one line, no newlines", !line.includes("\n"));
ok("valid JSON", typeof parsed === "object");
eq("timestamp is ISO 8601 UTC", parsed.ts, "2026-09-15T12:00:00.000Z");
eq("correlation id is preserved", parsed.request_id, "abc123");
eq("status is preserved", parsed.status, 502);
ok("formatLine redacts too",
  !has(formatLine({ level: "error", msg: "k=sk-ant-zzz" }, 0), "sk-ant-zzz"));

group("log — request id");
const ids = Array.from({ length: 2000 }, newRequestId);
ok("non-empty", ids.every((id) => id.length > 0));
ok("always exactly 8 chars, never truncated short",
  ids.every((id) => id.length === 8), `len ${ids[0].length}`);
ok("url/grep safe characters only", ids.every((id) => /^[a-z0-9]+$/.test(id)));
ok("no collisions in 2000", new Set(ids).size === ids.length, `${new Set(ids).size}/2000`);
