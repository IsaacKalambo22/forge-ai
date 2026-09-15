// Experiment 021. This now tests the code that actually SHIPS, rather than a
// mirror of it — see the note in ndjson.ts. The previous version of this suite
// reimplemented the algorithm and could have passed while both clients were
// broken.
import { createNdjsonParser, readNdjsonStream } from "@/lib/ndjson";
import type { StreamEvent } from "@/lib/messages";
import { group, ok, eq } from "./harness.mts";

const EVENTS: StreamEvent[] = [
  { type: "text", text: "Hello" },
  { type: "text", text: ", wor" },
  { type: "text", text: "ld — naïve ☕" },
  { type: "done", usage: { input_tokens: 12, output_tokens: 7 } as never,
    stop_reason: "end_turn", model: "claude-opus-5" },
];
const WIRE = EVENTS.map((e) => JSON.stringify(e) + "\n").join("");
const BYTES = new TextEncoder().encode(WIRE);
const EXPECTED = "Hello, world — naïve ☕";

function parseInChunks(size: number) {
  const parser = createNdjsonParser<StreamEvent>();
  const out: StreamEvent[] = [];
  for (let i = 0; i < BYTES.length; i += size) {
    out.push(...parser.push(BYTES.slice(i, i + size)));
  }
  out.push(...parser.flush());
  const text = out.filter((e) => e.type === "text").map((e) => e.text).join("");
  return { events: out, text, malformed: parser.malformed };
}

group("ndjson — every chunk size reassembles identically");
// THE test. Chunk boundaries are where this algorithm fails, and a single
// convenient chunk size proves nothing.
let allOk = true;
for (let size = 1; size <= BYTES.length + 2; size++) {
  const { events, text, malformed } = parseInChunks(size);
  if (events.length !== EVENTS.length || text !== EXPECTED || malformed !== 0) {
    allOk = false;
    ok(`chunk size ${size}`, false, `${events.length} events, text="${text}"`);
  }
}
ok(`all ${BYTES.length + 2} chunk sizes produce ${EVENTS.length} events and identical text`,
  allOk, EXPECTED);

group("ndjson — byte-at-a-time is the worst case and still works");
const oneByte = parseInChunks(1);
eq("event count", oneByte.events.length, 4);
eq("text", oneByte.text, EXPECTED);

group("ndjson — multi-byte characters are never split");
// TextDecoder needs stream:true to hold back a partial UTF-8 sequence. Without
// it, "—" and "☕" arrive as replacement characters.
ok("no replacement characters at any chunk size", (() => {
  for (let size = 1; size <= 12; size++) {
    if (parseInChunks(size).text.includes("�")) return false;
  }
  return true;
})());
ok("the em dash survives", oneByte.text.includes("—"));
ok("the 4-byte emoji survives", oneByte.text.includes("☕"));

group("ndjson — a line is only parsed once complete");
const partial = createNdjsonParser<StreamEvent>();
eq("half a JSON object yields nothing", partial.push('{"type":"text","te').length, 0);
eq("still nothing", partial.push('xt":"hi"').length, 0);
eq("the closing newline completes it", partial.push('}\n').length, 1);

group("ndjson — a trailing line with no newline is recovered by flush()");
// A stream that ends without a final newline would otherwise drop its last
// event silently — the worst kind, because it is usually the `done` event.
const noTrailing = createNdjsonParser<StreamEvent>();
eq("nothing yet", noTrailing.push('{"type":"text","text":"last"}').length, 0);
const flushed = noTrailing.flush();
eq("flush recovers it", flushed.length, 1);
eq("with its content", (flushed[0] as { text: string }).text, "last");

group("ndjson — blank lines are skipped, not counted as malformed");
const blanks = createNdjsonParser<StreamEvent>();
const withBlanks = blanks.push('\n\n{"type":"text","text":"a"}\n\n\n');
eq("one real event", withBlanks.length, 1);
eq("no malformed lines", blanks.malformed, 0);

group("ndjson — a malformed line does not kill the stream");
// The latent bug in the extracted code: both clients called JSON.parse
// unguarded, so one bad line would throw out of the read loop and silently
// truncate an otherwise fine response.
const broken = createNdjsonParser<StreamEvent>();
const survived = broken.push(
  '{"type":"text","text":"before"}\nNOT JSON AT ALL\n{"type":"text","text":"after"}\n',
);
eq("both good events survive", survived.length, 2);
eq("the bad one is counted", broken.malformed, 1);
eq("and the events either side are intact",
  survived.map((e) => (e as { text: string }).text), ["before", "after"]);

group("ndjson — readNdjsonStream over a real ReadableStream");
const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    // Deliberately awkward boundaries, including one mid-multi-byte.
    let i = 0;
    for (const size of [3, 17, 1, 40, 999]) {
      if (i >= BYTES.length) break;
      controller.enqueue(BYTES.slice(i, i + size));
      i += size;
    }
    if (i < BYTES.length) controller.enqueue(BYTES.slice(i));
    controller.close();
  },
});
const collected: StreamEvent[] = [];
const { malformed } = await readNdjsonStream<StreamEvent>(stream, (e) => collected.push(e));
eq("all events arrived", collected.length, 4);
eq("text is intact",
  collected.filter((e) => e.type === "text").map((e) => e.text).join(""), EXPECTED);
eq("nothing malformed", malformed, 0);
