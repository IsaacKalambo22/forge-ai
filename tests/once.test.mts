// Experiment 026. The cached-rejection bug, and the fix. Extended in 034 with
// readyWithin() — a caller-side timeout that does not cancel the shared load.
import { readyWithin, sharedRetryable } from "@/lib/once";
import { group, ok, eq } from "./harness.mts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A loader that fails `failures` times, then succeeds. Counts every attempt. */
function flaky(failures: number) {
  let attempts = 0;
  const load = async () => {
    attempts++;
    await new Promise((r) => setTimeout(r, 5));
    if (attempts <= failures) throw new Error(`network dropped (attempt ${attempts})`);
    return `model (attempt ${attempts})`;
  };
  return { load, get attempts() { return attempts; } };
}

async function outcome(p: Promise<string>): Promise<string> {
  try { return await p; } catch (e) { return `FAILED: ${(e as Error).message}`; }
}

group("once — THE BUG: `promise ??= load()` caches a rejection forever");
// Reproduced, so the regression is witnessed rather than described.
{
  const f = flaky(1);
  let cached: Promise<string> | null = null;
  const naive = () => (cached ??= f.load());
  const results = [await outcome(naive()), await outcome(naive()), await outcome(naive())];
  ok("the first call fails", results[0].startsWith("FAILED"));
  ok("…and so does every call after it, with the SAME stale error",
    results.every((r) => r.includes("attempt 1")), results.join(" | "));
  eq("the loader was never retried", f.attempts, 1);
}

group("once — the fix retries after a failure");
{
  const f = flaky(1);
  const get = sharedRetryable(f.load);
  eq("the first call still fails — it WAS a failure", (await outcome(get())).startsWith("FAILED"), true);
  eq("the second call retries and succeeds", await outcome(get()), "model (attempt 2)");
  eq("two attempts, not one", f.attempts, 2);
}

group("once — a success is cached, not reloaded");
{
  const f = flaky(0);
  const get = sharedRetryable(f.load);
  await get(); await get(); await get();
  eq("loaded exactly once", f.attempts, 1);
}

group("once — concurrent callers still share ONE load (Experiment 007's reason)");
{
  const f = flaky(0);
  const get = sharedRetryable(f.load);
  const all = await Promise.all([get(), get(), get(), get()]);
  eq("four callers, one load", f.attempts, 1);
  ok("all four got the same result", all.every((r) => r === all[0]));
}

group("once — concurrent callers during a FAILED load all see it, then recover");
{
  const f = flaky(1);
  const get = sharedRetryable(f.load);
  const during = await Promise.all([outcome(get()), outcome(get()), outcome(get())]);
  ok("everyone waiting on the failed attempt sees the failure",
    during.every((r) => r.startsWith("FAILED")));
  eq("but it was ONE attempt, not three", f.attempts, 1);
  eq("and the next call recovers", await outcome(get()), "model (attempt 2)");
}

group("once — repeated failures keep retrying");
{
  const f = flaky(3);
  const get = sharedRetryable(f.load);
  for (let i = 0; i < 3; i++) await outcome(get());
  eq("the fourth call finally succeeds", await outcome(get()), "model (attempt 4)");
  eq("four attempts in total", f.attempts, 4);
}

group("once — Experiment 034: readyWithin() resolves true once the promise settles first");
{
  const fast = delay(5).then(() => "done");
  eq("settles before the timeout", await readyWithin(fast, 200), true);
}

group("once — readyWithin() resolves false if the timeout comes first");
{
  const slow = delay(200).then(() => "done");
  eq("times out before the promise settles", await readyWithin(slow, 5), false);
}

group("once — readyWithin() does not cancel or restart the underlying work");
// The entire point: a caller that gives up must not affect the NEXT caller —
// this is what makes it safe to use on a `sharedRetryable` load.
{
  const f = flaky(0);
  const get = sharedRetryable(f.load); // f's loader takes 5ms
  const gaveUp = await readyWithin(get(), 1); // 1ms — times out first
  eq("this caller sees a timeout", gaveUp, false);
  eq("but the load was already in flight, only once", f.attempts, 1);
  eq("and the next caller gets the real result, not a re-run", await outcome(get()), "model (attempt 1)");
}

group("once — readyWithin() propagates a real rejection, distinct from a timeout");
// A caller needs to tell "still running" apart from "it broke" — collapsing
// both into `false` would make ensureIndexReady() report a build failure as
// "try again shortly", which is not true: trying again would fail the same way.
{
  const failing = Promise.reject(new Error("embedding model unavailable"));
  const result = await readyWithin(failing, 200).catch((e: unknown) => `THREW: ${(e as Error).message}`);
  eq("rejects rather than resolving false", result, "THREW: embedding model unavailable");
}

group("once — readyWithin() with an already-settled promise resolves immediately");
{
  eq("no timeout needed for work already done", await readyWithin(Promise.resolve("x"), 0), true);
}
