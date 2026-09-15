// Experiment 018. The cache breakpoint is the whole feature: put it in the
// wrong place and caching silently does nothing except add the 1.25x write
// premium — no error, no warning, a larger bill.
import { withCachedPrefix } from "@/lib/ai";
import { group, ok, eq } from "./harness.mts";

type Msg = { role: "user" | "assistant"; content: unknown };
const msg = (role: "user" | "assistant", content: string) => ({ role, content }) as Msg;

/** Does this message carry a cache breakpoint on its last block? */
function marked(m: Msg): boolean {
  const c = m.content;
  if (!Array.isArray(c) || c.length === 0) return false;
  return (c[c.length - 1] as { cache_control?: unknown }).cache_control !== undefined;
}
const markedCount = (ms: Msg[]) => ms.filter(marked).length;

group("caching — nothing to cache in a short conversation");
// Below three messages there is no prior exchange to re-read, and the minimum
// cacheable prefix would not be met anyway.
eq("a single message is untouched", withCachedPrefix([msg("user", "hi")] as never), [{ role: "user", content: "hi" }]);
eq("two messages are untouched", markedCount(withCachedPrefix(
  [msg("user", "a"), msg("assistant", "b")] as never) as never), 0);

group("caching — the breakpoint lands on the last message of the PRIOR history");
const three = withCachedPrefix(
  [msg("user", "one"), msg("assistant", "two"), msg("user", "three")] as never) as unknown as Msg[];
eq("all messages are preserved", three.length, 3);
eq("exactly one breakpoint", markedCount(three), 1);
ok("it is on the assistant turn before the newest message", marked(three[1]));

group("caching — the NEWEST message is never inside the cached prefix");
// The bug this prevents: the newest user message differs on every request, so
// including it invalidates the cache on the very request meant to read it.
ok("the newest message carries no breakpoint", !marked(three[2]));
eq("and its content is untouched", three[2].content, "three");

group("caching — the prefix content is preserved exactly");
// A byte change anywhere in the prefix invalidates everything after it, so the
// transformation must be lossless apart from the marker.
const blocks = three[1].content as { type: string; text: string }[];
eq("a string body became a single text block", blocks.length, 1);
eq("with the original text", [blocks[0].type, blocks[0].text], ["text", "two"]);

group("caching — a longer conversation still gets exactly one breakpoint");
// The API caps breakpoints per request; one is all this strategy needs.
const long = withCachedPrefix(Array.from({ length: 11 }, (_, i) =>
  msg(i % 2 === 0 ? "user" : "assistant", `m${i}`)) as never) as unknown as Msg[];
eq("all messages preserved", long.length, 11);
eq("still exactly one breakpoint", markedCount(long), 1);
ok("on the second-to-last message", marked(long[9]));
ok("never on the last", !marked(long[10]));

group("caching — an existing block array is handled, not stringified");
const withBlocks = withCachedPrefix([
  msg("user", "one"),
  { role: "assistant", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
  msg("user", "three"),
] as never) as unknown as Msg[];
const two = withBlocks[1].content as { type: string; text: string; cache_control?: unknown }[];
eq("both blocks survive", two.length, 2);
eq("the first is unmarked", two[0].cache_control, undefined);
ok("only the LAST block carries the breakpoint", two[1].cache_control !== undefined);

group("caching — the input is not mutated");
// A mutation here would corrupt the caller's working history mid-loop.
const original = [msg("user", "one"), msg("assistant", "two"), msg("user", "three")];
withCachedPrefix(original as never);
eq("the caller's array is untouched", original[1].content, "two");
