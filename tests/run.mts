// Discovers and runs every *.test.mts in this directory, in one process, so a
// single exit code says whether the project is sound.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { report, exitCode } from "./harness.mts";

// Experiment 036. `db.ts`'s singleton (`db()`) reads FORGE_DB_PATH exactly
// once, the first time anything calls it — so setting it here, before any
// test file is imported, is what lets a test safely exercise the singleton
// wrappers (`users`, `usage`, `revocations`) that guard.ts calls directly,
// without ever touching the real `.data/forge.db`. Every other test file
// avoids the singleton entirely (`openDatabase(":memory:")` instead) for the
// same reason — this makes the singleton path safe to use too, rather than
// adding a second way around it.
process.env.FORGE_DB_PATH ??= ":memory:";

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith(".test.mts")).sort();

console.log(`forge-ai — ${files.length} test files`);

for (const file of files) {
  await import(pathToFileURL(join(here, file)).href);
}

report();
process.exit(exitCode());
