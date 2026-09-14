import { evaluateExpression } from "@/lib/expression";
import { group, near, throws } from "./harness.mts";

group("expression — arithmetic");
near("2+2", evaluateExpression("2+2"), 4);
near("17 * 3 + 1.5", evaluateExpression("17 * 3 + 1.5"), 52.5);
near("(17 * 3) + 1.5", evaluateExpression("(17 * 3) + 1.5"), 52.5);
near("2 + 3 * 4 (precedence)", evaluateExpression("2 + 3 * 4"), 14);
near("(2 + 3) * 4", evaluateExpression("(2 + 3) * 4"), 20);
near("10 / 4", evaluateExpression("10 / 4"), 2.5);
near("10 % 3", evaluateExpression("10 % 3"), 1);
near("-5 + 3 (unary)", evaluateExpression("-5 + 3"), -2);
near("-(2 + 3)", evaluateExpression("-(2 + 3)"), -5);
near("--3", evaluateExpression("--3"), 3);
near("2 * -3", evaluateExpression("2 * -3"), -6);
near("((((1))))", evaluateExpression("((((1))))"), 1);
near("0.1 + 0.2 (float reality)", evaluateExpression("0.1 + 0.2"), 0.30000000000000004);

group("expression — must be rejected");
for (const bad of ["1 / 0", "1 % 0", "2 +", "(2 + 3", "2 + 3)", "1 2", ""]) {
  throws(`malformed: ${JSON.stringify(bad)}`, () => evaluateExpression(bad));
}

group("expression — code execution payloads (Experiment 006)");
for (const payload of [
  "process.exit(1)",
  "require('fs')",
  "1; console.log('pwned')",
  "globalThis",
  "process.env.ANTHROPIC_API_KEY",
  "__proto__",
  "1e400",
  "alert(1)",
]) {
  throws(payload, () => evaluateExpression(payload));
}
