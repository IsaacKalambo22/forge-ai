// Share one in-flight load between concurrent callers — and forget it if it
// fails. No imports, no privileges.
//
// WHY THIS EXISTS (the project rule: justify it or don't build it).
//
//   What problem appeared?   Three modules (embeddings, search, knowledge) cached
//                            a load as `promise ??= load()`. Experiment 007
//                            chose that so two requests arriving together share
//                            one model load instead of starting two.
//   Why was that              `??=` only assigns when the value is null. A
//   insufficient?            REJECTED promise is not null — so a failed load was
//                            cached FOREVER. Found when a fresh deploy's first
//                            search hit a model download that the network cut
//                            off after 79 seconds: every later call then failed
//                            with that same stale error, and only a restart
//                            recovered. One transient blip, permanent outage.
//   What does it add?        One function, used in the three places that had
//                            the same bug.
//   Why is the trade         The bug was copied three times because the pattern
//   justified?               looked obviously correct. Fixing it once, with a
//                            test, is what stops it being copied a fourth time.

export function sharedRetryable<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;

  return () => {
    pending ??= load().catch((error: unknown) => {
      // Forget the failure so the NEXT caller starts a fresh attempt. Callers
      // already waiting on this promise still see the rejection — they were
      // part of this attempt.
      pending = null;
      throw error;
    });
    return pending;
  };
}
