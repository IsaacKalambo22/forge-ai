import { readdirSync, readFileSync, existsSync } from "node:fs";

import { chunkMarkdown, chunkText } from "@/lib/chunk";
import { group, ok } from "./harness.mts";

group("chunk — heading structure");
const nested = chunkMarkdown(
  `# Top\n\ntoo short\n\n## Alpha\n\n${"a".repeat(300)}\n\n### Beta\n\n${"b".repeat(300)}\n\n## Gamma\n\n${"c".repeat(300)}`,
  "Doc",
);
ok("heading trail nests", nested.some((c) => c.heading === "Doc > Top > Alpha > Beta"));
ok("a sibling heading resets the trail", nested.some((c) => c.heading === "Doc > Top > Gamma"));
ok("sections below the minimum are dropped", !nested.some((c) => c.text.includes("too short")));

const fenced = chunkMarkdown(
  "# Doc\n\n```bash\n# this is a comment, not a heading\necho hi\n```\n\n" + "x".repeat(200),
  "T",
);
ok("'#' inside a code fence is not a heading", fenced.length === 1 && fenced[0].heading === "T > Doc",
  `${fenced.length} chunk(s)`);

group("chunk — size handling");
const big = chunkMarkdown(
  `# Big\n\n${Array.from({ length: 20 }, (_, i) => `Paragraph ${i} ` + "y".repeat(200)).join("\n\n")}`,
  "T",
);
ok("oversized section is split", big.length > 1, `${big.length} chunks`);
ok("split chunks stay under the limit", big.every((c) => c.text.length <= 1600),
  `max ${Math.max(...big.map((c) => c.text.length))}`);
const longPara = chunkMarkdown(`# X\n\n${"z".repeat(5000)}`, "T");
ok("a single over-long paragraph is kept whole", longPara.length === 1 && longPara[0].text.length === 5000);

group("chunk — the real notebook");
const files = [
  ...readdirSync("experiments").map((d) => [`experiments/${d}/README.md`, d] as const),
  ["docs/ARCHITECTURE.md", "ARCHITECTURE"] as const,
  ["docs/GLOSSARY.md", "GLOSSARY"] as const,
].filter(([f]) => existsSync(f));
const sizes = files
  .flatMap(([f, t]) => chunkMarkdown(readFileSync(f, "utf8"), t))
  .map((c) => chunkText(c).length)
  .sort((a, b) => a - b);
ok("produces chunks from every document", sizes.length > files.length, `${sizes.length} chunks`);
ok("no empty chunks", sizes[0] > 0, `min ${sizes[0]}`);
ok("median is a usable size", sizes[Math.floor(sizes.length / 2)] > 200,
  `median ${sizes[Math.floor(sizes.length / 2)]}`);
