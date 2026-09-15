// Experiment 013 — the retrieval benchmark.
//
// Separate from `pnpm test` on purpose: this loads a real embedding model and
// takes seconds, while the unit suite must stay fast enough to run constantly.
// A slow benchmark folded into a fast suite gets skipped, and a skipped
// benchmark measures nothing.
//
// Needs no API key. Retrieval is measurable today precisely because Experiment
// 007 put the embedding model in-process rather than behind a paid API.
import { EVAL_QUERIES } from "@/lib/evalset";
import { LESSONS } from "@/lib/corpus";
import { searchLessons } from "@/lib/search";
import { recallAtK, precisionAtK, reciprocalRank, mean } from "@/lib/metrics";

const N = LESSONS.length;

/**
 * The baseline: rank by shared content words. Deliberately naive — it is the
 * control, not a competitor. Without it, "MRR 0.81" is a number with nothing to
 * compare against, and there is no way to answer the only question that
 * matters: is the embedding model earning its complexity?
 */
const STOP = new Set(["the","and","that","this","with","from","your","you","for","are","not","but","what","when","how","does","did","can","its","they","them","their","have","has","was","were","will","would","about","into","only","just","then","than","some","because","which","while","there","here","more","most","over","should","could","们"]);
const words = (s: string) =>
  new Set(s.toLowerCase().match(/[a-z']+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? []);

function lexicalRanking(query: string): string[] {
  const q = words(query);
  return LESSONS
    .map((lesson) => {
      const l = words(lesson.text);
      const shared = [...q].filter((w) => l.has(w)).length;
      return { id: lesson.id, score: shared / Math.sqrt(l.size || 1) };
    })
    .sort((a, b) => b.score - a.score)
    .map((r) => r.id);
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`.padStart(4);
const num = (v: number) => v.toFixed(3);

type Row = { query: string; hard: boolean; rank: number | null; rr: number; r3: number };

async function score(
  label: string,
  rank: (q: string) => Promise<string[]> | string[],
): Promise<{ rows: Row[]; mrr: number; r1: number; r3: number; r5: number; p3: number }> {
  const rows: Row[] = [];
  const rr: number[] = [], r1: number[] = [], r3: number[] = [], r5: number[] = [], p3: number[] = [];

  for (const q of EVAL_QUERIES) {
    const ranking = await rank(q.query);
    if (ranking.length !== N) throw new Error(`${label}: expected ${N} ids, got ${ranking.length}`);

    const relevantSet = new Set(q.relevant);
    const firstIndex = ranking.findIndex((id) => relevantSet.has(id));

    const thisRr = reciprocalRank(q.relevant, ranking);
    const thisR3 = recallAtK(q.relevant, ranking, 3);
    rr.push(thisRr);
    r1.push(recallAtK(q.relevant, ranking, 1));
    r3.push(thisR3);
    r5.push(recallAtK(q.relevant, ranking, 5));
    p3.push(precisionAtK(q.relevant, ranking, 3));

    rows.push({
      query: q.query,
      hard: q.hard === true,
      rank: firstIndex === -1 ? null : firstIndex + 1,
      rr: thisRr,
      r3: thisR3,
    });
  }

  return { rows, mrr: mean(rr), r1: mean(r1), r3: mean(r3), r5: mean(r5), p3: mean(p3) };
}

console.log(`\nforge-ai — retrieval benchmark`);
console.log(`${EVAL_QUERIES.length} labelled queries over ${N} lessons\n`);

const lexical = await score("lexical", lexicalRanking);
const dense = await score("dense", async (q) => (await searchLessons(q, N)).map((s) => s.item.id));

console.log("  rank of first correct answer (1 is best, · = not retrieved)\n");
console.log(`  ${"query".padEnd(58)} ${"lex".padStart(4)} ${"dense".padStart(6)}`);
console.log(`  ${"-".repeat(58)} ${"-".repeat(4)} ${"-".repeat(6)}`);

for (let i = 0; i < dense.rows.length; i++) {
  const d = dense.rows[i], l = lexical.rows[i];
  const mark = d.hard ? "*" : " ";
  const label = (d.query.length > 55 ? `${d.query.slice(0, 54)}…` : d.query) + mark;
  const dr = d.rank === null ? "·" : String(d.rank);
  const lr = l.rank === null ? "·" : String(l.rank);
  // Flag anything the application's own k=3 would miss.
  const flag = d.rank === null || d.rank > 3 ? "  ← miss at k=3" : "";
  console.log(`  ${label.padEnd(58)} ${lr.padStart(4)} ${dr.padStart(6)}${flag}`);
}

console.log(`\n  * = deliberately low word overlap with its answer\n`);
console.log(`  ${"metric".padEnd(30)} ${"lexical".padStart(8)} ${"dense".padStart(8)}`);
console.log(`  ${"-".repeat(30)} ${"-".repeat(8)} ${"-".repeat(8)}`);
console.log(`  ${"recall@1".padEnd(30)} ${pct(lexical.r1).padStart(8)} ${pct(dense.r1).padStart(8)}`);
console.log(`  ${"recall@3  (what /api/ask uses)".padEnd(30)} ${pct(lexical.r3).padStart(8)} ${pct(dense.r3).padStart(8)}`);
console.log(`  ${"recall@5".padEnd(30)} ${pct(lexical.r5).padStart(8)} ${pct(dense.r5).padStart(8)}`);
// Most queries have exactly one relevant lesson, so precision@3 cannot exceed
// 1/3 for them. Print the ceiling next to it or the number reads as a failure.
const p3Ceiling = mean(EVAL_QUERIES.map((q) => Math.min(q.relevant.length, 3) / 3));
console.log(`  ${"precision@3".padEnd(30)} ${pct(lexical.p3).padStart(8)} ${pct(dense.p3).padStart(8)}   (ceiling ${pct(p3Ceiling).trim()})`);
console.log(`  ${"MRR".padEnd(30)} ${num(lexical.mrr).padStart(8)} ${num(dense.mrr).padStart(8)}`);

const hard = dense.rows.filter((r) => r.hard);
const hardMrr = mean(hard.map((r) => r.rr));
const easyMrr = mean(dense.rows.filter((r) => !r.hard).map((r) => r.rr));
console.log(`\n  dense MRR on low-overlap queries : ${num(hardMrr)}  (${hard.length} queries)`);
console.log(`  dense MRR on the rest            : ${num(easyMrr)}`);

const misses = dense.rows.filter((r) => r.rank === null || r.rank > 3);
console.log(`\n  ${misses.length} of ${dense.rows.length} queries would miss at the k=3 the app actually sends.`);
for (const m of misses) console.log(`    rank ${m.rank ?? "·"} — ${m.query}`);
console.log();
