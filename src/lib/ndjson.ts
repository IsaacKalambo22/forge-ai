// Incremental NDJSON reassembly. No imports, no privileges.
//
// WHY THIS ABSTRACTION EXISTS (the project rule: justify it or don't build it).
//
//   What problem appeared?      Experiment 021 needed a fourth copy of the
//                               chunk-buffering reader, for the e2e client.
//   Why was the previous        There were already THREE — chat.tsx, ask.tsx,
//   approach insufficient?      and tests/stream.test.mts, whose own first
//                               comment says "this mirrors it". The test
//                               therefore verified a COPY of the algorithm, not
//                               the code that ships. It could pass while either
//                               client had the exact bug it was written to
//                               catch.
//   What does it add?           One module and one import in each caller.
//   Why is the trade justified? Three implementations of a boundary-sensitive
//                               algorithm, one test covering none of them.
//
// The bug being guarded against, from Experiment 004:
//
//   "A read gives you bytes, not messages. Network chunks do not align with
//    line boundaries, so buffer the tail and parse only complete lines.
//    TextDecoder needs stream:true to hold back partial multi-byte characters.
//    A bug that depends on chunk boundaries can pass a casual test and fail in
//    production."

export type NdjsonParser<T> = {
  /** Feed a chunk; returns whatever complete events it completed. */
  push(chunk: Uint8Array | string): T[];
  /** Call at end of stream. Returns a trailing event with no newline, if any. */
  flush(): T[];
  /** Lines that were not valid JSON. See below — these are skipped, not thrown. */
  readonly malformed: number;
};

export function createNdjsonParser<T>(): NdjsonParser<T> {
  const decoder = new TextDecoder();
  let buffer = "";
  let malformed = 0;

  function drain(text: string, final: boolean): T[] {
    buffer += text;
    const lines = buffer.split("\n");
    // The last element is either an incomplete line or an empty string. Keep it
    // in the buffer unless this is the end of the stream, where there is
    // nothing further to complete it.
    buffer = final ? "" : (lines.pop() ?? "");
    if (final && lines.length === 0) return [];

    const events: T[] = [];
    for (const line of lines) {
      if (line.trim() === "") continue;
      try {
        events.push(JSON.parse(line) as T);
      } catch {
        // A malformed line must not kill the stream. The clients previously
        // called JSON.parse unguarded, so one bad line would throw out of the
        // read loop and silently truncate an otherwise fine response.
        malformed++;
      }
    }
    return events;
  }

  return {
    push(chunk) {
      return drain(
        typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }),
        false,
      );
    },
    flush() {
      // stream:false flushes any held-back partial multi-byte character.
      return drain(decoder.decode(), true);
    },
    get malformed() {
      return malformed;
    },
  };
}

/** Reads a whole `Response` body as NDJSON. Used by the clients and the e2e harness. */
export async function readNdjsonStream<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<{ malformed: number }> {
  const reader = body.getReader();
  const parser = createNdjsonParser<T>();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const event of parser.push(value)) onEvent(event);
  }
  for (const event of parser.flush()) onEvent(event);

  return { malformed: parser.malformed };
}
