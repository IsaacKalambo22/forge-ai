// Experiment 031, gated by Experiment 032. /api/ask has no conversation to
// build a growing prefix from, so the breakpoint from `withCachedPrefix`
// doesn't apply here — this tests its equivalent, `withCachedAskSystem`.
//
// What this file proves: the REQUEST SHAPE — the breakpoint lands only on
// content that is actually identical across calls, and only when that
// content is estimated large enough to plausibly be read back (032). It does
// NOT and CANNOT prove a real cache hit — that needs `cache_read_input_tokens`
// from a live call, which needs the credential this project doesn't have.
import { ASK_SYSTEM_PREAMBLE, withCachedAskSystem } from "@/lib/ai";
import { MIN_CACHEABLE_TOKENS, estimateTokens } from "@/lib/context";
import { PASSAGE_RULES, passageDelimiterNotice } from "@/lib/passage";
import { group, ok, eq } from "./harness.mts";

type Block = { type: string; text: string; cache_control?: { type: string } };

// Large enough on its own to clear MIN_CACHEABLE_TOKENS, for the tests that
// need to see marking actually happen.
const bigPreamble = `PREAMBLE: ${"x".repeat(MIN_CACHEABLE_TOKENS * 4)}`;

group("ask-caching — Experiment 032: the REAL preamble, measured, is not marked");
// The finding this experiment exists to act on, not just document: estimated
// at run time, not assumed.
{
  const estimated = estimateTokens(ASK_SYSTEM_PREAMBLE);
  ok(`ASK_SYSTEM_PREAMBLE is ~${estimated} tokens — below the ${MIN_CACHEABLE_TOKENS} minimum`,
    estimated < MIN_CACHEABLE_TOKENS, `${estimated} < ${MIN_CACHEABLE_TOKENS}`);

  const blocks = withCachedAskSystem(ASK_SYSTEM_PREAMBLE, "aaaa1111", "passages") as Block[];
  eq("still two blocks — the request shape doesn't change", blocks.length, 2);
  eq("but the preamble carries no breakpoint — marking it would be a pure loss",
    blocks[0].cache_control, undefined);
}

group("ask-caching — a preamble estimated large enough IS marked");
{
  const blocks = withCachedAskSystem(bigPreamble, "aaaa1111", "PASSAGES") as Block[];
  eq("two blocks", blocks.length, 2);
  ok("the preamble carries the breakpoint", blocks[0].cache_control?.type === "ephemeral");
  ok("the second block carries none", blocks[1].cache_control === undefined);
}

group("ask-caching — the preamble block is exactly what was passed in, untouched");
{
  const blocks = withCachedAskSystem(bigPreamble, "aaaa1111", "PASSAGES") as Block[];
  eq("no wrapping, no trimming, no appended text", blocks[0].text, bigPreamble);
}

group("ask-caching — the second block names the real delimiter, then the passages");
{
  const nonce = "deadbeefcafef00d";
  const blocks = withCachedAskSystem(bigPreamble, nonce, "the passage content") as Block[];
  const notice = passageDelimiterNotice(nonce);
  ok("opens with the delimiter notice", blocks[1].text.startsWith(notice));
  ok("passages follow it", blocks[1].text.includes("the passage content"));
  ok("in that order", blocks[1].text.indexOf(notice) < blocks[1].text.indexOf("the passage content"));
}

group("ask-caching — two different questions produce a BYTE-IDENTICAL preamble block");
// This is the entire feature, once a preamble IS large enough to mark. If it
// were not byte-identical, the cache breakpoint would never be reused across
// calls and the whole mechanism would be inert — the same failure mode 018
// documented for withCachedPrefix, from yet another angle.
{
  const call1 = withCachedAskSystem(bigPreamble, "1111111111111111", "passages about X") as Block[];
  const call2 = withCachedAskSystem(bigPreamble, "2222222222222222", "passages about Y") as Block[];

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
