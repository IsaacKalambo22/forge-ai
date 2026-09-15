// Experiment 013. The benchmark's own integrity. A typo in a label is the worst
// kind of bug here: it scores 0 forever, looks like a retrieval failure, and
// sends you debugging the embedding model instead of the data.
import { EVAL_QUERIES } from "@/lib/evalset";
import { LESSONS } from "@/lib/corpus";
import { group, ok } from "./harness.mts";

const ids = new Set(LESSONS.map((l) => l.id));

group("evalset — integrity");
ok("the set is not empty", EVAL_QUERIES.length > 0, `${EVAL_QUERIES.length} queries`);

const unknown = EVAL_QUERIES.flatMap((q) => q.relevant.filter((id) => !ids.has(id)));
ok("every labelled id exists in the corpus", unknown.length === 0,
  unknown.length ? `unknown: ${unknown.join(", ")}` : `${ids.size} lessons`);

ok("every query labels at least one relevant lesson",
  EVAL_QUERIES.every((q) => q.relevant.length > 0));

ok("no query duplicates an id within its own labels",
  EVAL_QUERIES.every((q) => new Set(q.relevant).size === q.relevant.length));

const texts = EVAL_QUERIES.map((q) => q.query);
ok("no duplicate queries", new Set(texts).size === texts.length);

// Coverage: a benchmark that only asks about a third of the corpus will not
// notice the other two thirds regressing.
const covered = new Set(EVAL_QUERIES.flatMap((q) => q.relevant));
ok("every lesson is reachable by some query", covered.size === ids.size,
  `${covered.size}/${ids.size} lessons covered`);

// Guards rule 1 in evalset.ts. A query that reuses the answer's rare words is
// testing string overlap, not retrieval. This is crude — stopwords only removed
// by length — but it catches the obvious case of pasting the lesson back in.
const STOP = new Set(["the","and","that","this","with","from","your","you","for","are","not","but","what","when","how","does","did","can","its","it's","they","them","their","have","has","was","were","will","would","about","into","only","just","then","than","some","because","which","while","there","here","more","most","over"]);
const words = (s: string) => new Set(
  s.toLowerCase().match(/[a-z']+/g)?.filter((w) => w.length > 3 && !STOP.has(w)) ?? [],
);
const leaky = EVAL_QUERIES.filter((q) => {
  const qw = words(q.query);
  if (qw.size === 0) return false;
  const lessonText = q.relevant
    .map((id) => LESSONS.find((l) => l.id === id)?.text ?? "")
    .join(" ");
  const lw = words(lessonText);
  const shared = [...qw].filter((w) => lw.has(w)).length;
  return shared / qw.size > 0.5;
});
ok("no query copies more than half its content words from the answer",
  leaky.length === 0,
  leaky.length ? leaky.map((q) => `"${q.query}"`).join("; ") : `${EVAL_QUERIES.length} checked`);
