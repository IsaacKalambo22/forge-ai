// Discovers and runs every *.test.mts in this directory, in one process, so a
// single exit code says whether the project is sound.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { report, exitCode } from "./harness.mts";

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith(".test.mts")).sort();

console.log(`forge-ai — ${files.length} test files`);

for (const file of files) {
  await import(pathToFileURL(join(here, file)).href);
}

report();
process.exit(exitCode());
