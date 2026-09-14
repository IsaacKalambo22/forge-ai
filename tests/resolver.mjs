// Lets plain Node import this project's source the way Next.js does.
//
// Two gaps between "what TypeScript/Next accept" and "what Node ESM accepts":
//   1. `@/lib/x`  — a tsconfig path alias Node knows nothing about
//   2. `./expression` — extensionless, which bundlers resolve and Node does not
//
// Combined with `--conditions=react-server`, which makes the `server-only`
// marker resolve to an empty module, this makes every module in src/ testable —
// including the ones that were unreachable for three experiments.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

function withExtension(path) {
  if (existsSync(path)) return path;
  for (const candidate of [`${path}.ts`, `${path}.tsx`, `${path}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // tsconfig path alias
    if (specifier.startsWith("@/")) {
      const found = withExtension(resolvePath(ROOT, "src", specifier.slice(2)));
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }

    // extensionless relative import
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const base = dirname(fileURLToPath(context.parentURL));
      const found = withExtension(resolvePath(base, specifier));
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});
