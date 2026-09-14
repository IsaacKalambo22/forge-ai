// Pure text splitting. No imports, no privileges, no file system — the same
// pattern as expression.ts and vector.ts, and for the same reason: where you
// cut a document decides what can be found in it, so this logic has to be
// testable on its own.

export type Chunk = {
  /** Heading trail, e.g. "Experiment 004 — Streaming > Observations > Finding: …" */
  heading: string;
  text: string;
};

/** Roughly 4 characters per token, so ~1,600 characters is ~400 tokens. */
const MAX_CHARS = 1600;
const MIN_CHARS = 120;

/**
 * Split markdown on heading boundaries, then split any oversized section on
 * paragraph boundaries.
 *
 * Headings are used because they are the author's own statement of where one
 * idea ends. Splitting every N characters instead would cut sentences in half
 * and strand the evidence for a claim in a different chunk from the claim.
 *
 * Each chunk is prefixed with its heading trail, so a retrieved fragment says
 * where it came from — both for the reader and for the embedding, which gets
 * useful context it would otherwise lack.
 */
export function chunkMarkdown(markdown: string, title: string): Chunk[] {
  const lines = markdown.split("\n");
  const sections: { heading: string; body: string[] }[] = [];

  // Heading stack: index 0 is `#`, index 1 is `##`, and so on.
  const trail: string[] = [title];
  let body: string[] = [];
  let inFence = false;

  const flush = () => {
    if (body.length > 0) {
      sections.push({ heading: trail.filter(Boolean).join(" > "), body });
      body = [];
    }
  };

  for (const line of lines) {
    // Fenced code blocks may contain `#` comments that are not headings.
    if (line.startsWith("```")) inFence = !inFence;

    const match = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);

    if (match) {
      flush();
      const depth = match[1].length;
      trail.length = Math.min(trail.length, depth);
      while (trail.length < depth) trail.push("");
      trail[depth] = match[2].trim();
      trail.length = depth + 1;
    } else {
      body.push(line);
    }
  }
  flush();

  const chunks: Chunk[] = [];

  for (const section of sections) {
    const text = section.body.join("\n").trim();
    if (text.length < MIN_CHARS) continue; // headings with no real content

    if (text.length <= MAX_CHARS) {
      chunks.push({ heading: section.heading, text });
      continue;
    }

    // Oversized: split on blank lines, packing paragraphs up to the limit.
    let current: string[] = [];
    let size = 0;

    const push = () => {
      const joined = current.join("\n\n").trim();
      if (joined.length >= MIN_CHARS) {
        chunks.push({ heading: section.heading, text: joined });
      }
      current = [];
      size = 0;
    };

    for (const paragraph of text.split(/\n{2,}/)) {
      // A single paragraph over the limit is kept whole rather than cut
      // mid-sentence. An over-long chunk is a cost problem; a chunk severed
      // mid-claim is a correctness problem.
      if (size > 0 && size + paragraph.length > MAX_CHARS) push();
      current.push(paragraph);
      size += paragraph.length + 2;
    }
    push();
  }

  return chunks;
}

/** The text actually embedded: heading trail plus body. */
export function chunkText(chunk: Chunk): string {
  return `${chunk.heading}\n\n${chunk.text}`;
}
