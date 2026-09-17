// Experiment 031 (continuing 018). /api/ask has no conversation to build a
// growing prefix from, so the breakpoint from `withCachedPrefix` doesn't
// apply here — this tests its equivalent, `withCachedAskSystem`.
//
// What this file proves: the REQUEST SHAPE — the breakpoint lands only on
// content that is actually identical across calls, and never on the nonce or
// the passages, which must differ every time. It does NOT and CANNOT prove a
// real cache hit — that needs `cache_read_input_tokens` from a live call,
// which needs the credential this project doesn't have (see README).
import { ASK_SYSTEM_PREAMBLE, withCachedAskSystem } from "@/lib/ai";
import { PASSAGE_RULES, passageDelimiterNotice } from "@/lib/passage";
import { group, ok, eq } from "./harness.mts";

type Block = { type: string; text: string; cache_control?: { type: string } };

group("ask-caching — exactly one breakpoint, on the preamble");
{
  const blocks = withCachedAskSystem("PREAMBLE", "aaaa1111", "PASSAGES") as Block[];
  eq("two blocks", blocks.length, 2);
  ok("the preamble carries the breakpoint", blocks[0].cache_control?.type === "ephemeral");
  ok("the second block carries none", blocks[1].cache_control === undefined);
}

group("ask-caching — the preamble block is exactly what was passed in, untouched");
{
  const blocks = withCachedAskSystem(ASK_SYSTEM_PREAMBLE, "aaaa1111", "PASSAGES") as Block[];
  eq("no wrapping, no trimming, no appended text", blocks[0].text, ASK_SYSTEM_PREAMBLE);
}

group("ask-caching — the second block names the real delimiter, then the passages");
{
  const nonce = "deadbeefcafef00d";
  const blocks = withCachedAskSystem("PREAMBLE", nonce, "the passage content") as Block[];
  const notice = passageDelimiterNotice(nonce);
  ok("opens with the delimiter notice", blocks[1].text.startsWith(notice));
  ok("passages follow it", blocks[1].text.includes("the passage content"));
  ok("in that order", blocks[1].text.indexOf(notice) < blocks[1].text.indexOf("the passage content"));
}

group("ask-caching — two different questions produce a BYTE-IDENTICAL preamble block");
// This is the entire feature. If it were not byte-identical, the cache
// breakpoint would never be reused across calls and the whole mechanism would
// be inert — silently, the same failure mode 018 documented for withCachedPrefix.
{
  const call1 = withCachedAskSystem(ASK_SYSTEM_PREAMBLE, "1111111111111111", "passages about X") as Block[];
  const call2 = withCachedAskSystem(ASK_SYSTEM_PREAMBLE, "2222222222222222", "passages about Y") as Block[];

  eq("preamble block: identical text", call1[0].text, call2[0].text);
  eq("preamble block: identical cache_control", call1[0].cache_control, call2[0].cache_control);
  ok("dynamic block DOES differ — different nonce, different passages", call1[1].text !== call2[1].text);
}

group("ask-caching — the preamble contains no per-request content");
// The one way this mechanism breaks silently: a nonce or a passage leaking
// into what is supposed to be the stable half.
{
  ok("no passage tag pattern", !/<passage-[0-9a-f]+>/.test(ASK_SYSTEM_PREAMBLE));
  ok("contains the DATA rule", /DATA/.test(ASK_SYSTEM_PREAMBLE));
  eq("is exactly the notebook framing + PASSAGE_RULES", ASK_SYSTEM_PREAMBLE,
    "You answer questions about a specific engineering notebook.\n\n" + PASSAGE_RULES);
}

group("ask-caching — PASSAGE_RULES itself carries no nonce (the thing being cached)");
{
  ok("no passage tag pattern in the rules", !/<passage-[0-9a-f]+>/.test(PASSAGE_RULES));
}
