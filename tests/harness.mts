// A test harness in 40 lines. No framework: this project has one dependency it
// did not write for a reason, and a test runner is not worth a second one when
// Node already ships assertions, a module loader and a process exit code.

let suite = "";
let passed = 0;
let failed = 0;
const failures: string[] = [];

export function group(name: string): void {
  suite = name;
  console.log(`\n  ${name}`);
}

export function ok(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`    \x1b[32m✓\x1b[0m ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
  } else {
    failed++;
    failures.push(`${suite} › ${label}${detail ? `  ${detail}` : ""}`);
    console.log(`    \x1b[31m✗ ${label}${detail ? `  ${detail}` : ""}\x1b[0m`);
  }
}

export function eq(label: string, actual: unknown, expected: unknown): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(label, same, same ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

export function near(label: string, actual: number, expected: number, epsilon = 1e-9): void {
  ok(label, Math.abs(actual - expected) < epsilon, `= ${actual}`);
}

/** Asserts the function throws, and reports the message — the message is part of the contract. */
export function throws(label: string, fn: () => unknown): void {
  try {
    fn();
    ok(label, false, "did not throw");
  } catch (error) {
    ok(label, true, (error as Error).message);
  }
}

export function report(): void {
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    for (const failure of failures) console.log(`    - ${failure}`);
  }
}

export function exitCode(): number {
  return failed > 0 ? 1 : 0;
}
