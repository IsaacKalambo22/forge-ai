// Experiment 029. `guard()` learns WHO before it calls `rateLimit()` — but
// until now the limiter never asked. Two users behind one IP shared a bucket;
// one user rotating IPs got a fresh bucket each time. Neither was the intent
// of a PER-CALLER limit.
import { rateLimit } from "@/lib/guard";
import { group, ok } from "./harness.mts";

function req(ip: string): Request {
  return new Request("http://x/api/chat", { headers: { "x-forwarded-for": ip } });
}

// `chat` costs 1 against PER_CALLER (capacity 20) and 1 against the shared
// GLOBAL daily bucket (capacity 200) — both fresh module state per test file,
// so these numbers are exact rather than approximate.

group("rate limit — keyed by user when identity is known");
{
  const alice = () => rateLimit(req("203.0.113.1"), "chat", "alice");
  const bob = () => rateLimit(req("203.0.113.1"), "chat", "bob");
  for (let i = 0; i < 20; i++) ok(`alice call ${i + 1} allowed`, alice() === null);
  ok("alice's 21st call, same IP as bob, is denied", alice() !== null);
  ok("bob, same IP, is NOT denied — a different user, a different bucket", bob() === null);
}

group("rate limit — one user is one bucket across IPs");
{
  const carol = (ip: string) => rateLimit(req(ip), "chat", "carol");
  for (let i = 0; i < 20; i++) ok(`carol call ${i + 1} (ip ${i}) allowed`, carol(`198.51.100.${i}`) === null);
  ok("carol's 21st call, a brand-new IP, is still denied — rotating IPs buys nothing", carol("198.51.100.99") !== null);
}

group("rate limit — no identity still falls back to IP (login/register)");
{
  const anon = () => rateLimit(req("192.0.2.1"), "chat");
  for (let i = 0; i < 20; i++) ok(`anon call ${i + 1} allowed`, anon() === null);
  ok("anon's 21st call, same IP, is denied", anon() !== null);
}
