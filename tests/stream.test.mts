// The NDJSON reassembly from Experiment 004. The algorithm lives in chat.tsx
// and ask.tsx; this mirrors it, because the bug it guards against depends on
// packet boundaries and cannot be found by clicking around.
import type { StreamEvent } from "@/lib/messages";
import { group, ok } from "./harness.mts";

const events: StreamEvent[] = [
  { type: "text", text: "Hello" },
  { type: "text", text: ", wor" },
  { type: "text", text: "ld — naïve ☕" },
  { type: "done", usage: { input_tokens: 12, output_tokens: 7 } as never, stop_reason: "end_turn", model: "claude-opus-5" },
];
const bytes = new TextEncoder().encode(events.map((e) => JSON.stringify(e) + "\n").join(""));
const EXPECTED = "Hello, world — naïve ☕";

/** The correct reader: buffer the tail, parse only complete lines. */
function buffered(chunkSize: number) {
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let parsed = 0;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    buffer += decoder.decode(bytes.slice(i, i + chunkSize), { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      const event = JSON.parse(line) as StreamEvent;
      parsed++;
      if (event.type === "text") text += event.text;
    }
  }
  return { text, parsed, leftover: buffer };
}

/** The obvious-but-wrong reader: parse each chunk as it arrives. */
function naive(chunkSize: number) {
  const decoder = new TextDecoder();
  let parsed = 0;
  let errors = 0;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    for (const line of decoder.decode(bytes.slice(i, i + chunkSize)).split("\n")) {
      if (line.trim() === "") continue;
      try { JSON.parse(line); parsed++; } catch { errors++; }
    }
  }
  return { parsed, errors };
}

group("stream — reassembly across chunk boundaries");
for (const size of [1, 2, 3, 5, 7, 13, 32, 64, 999]) {
  const r = buffered(size);
  ok(`${String(size).padStart(3)} byte chunks`,
    r.text === EXPECTED && r.parsed === 4 && r.leftover === "",
    r.text === EXPECTED ? "" : JSON.stringify(r.text));
}

group("stream — the naive reader fails (negative control)");
for (const size of [13, 64]) {
  const r = naive(size);
  ok(`${size} byte chunks: unbuffered parsing breaks`, r.errors > 0,
    `${r.parsed} parsed, ${r.errors} JSON.parse failures`);
}
ok("multi-byte UTF-8 survives 1-byte chunks", buffered(1).text === EXPECTED,
  "TextDecoder({stream:true}) holds partial code points");
