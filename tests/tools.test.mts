// This file is the point of Experiment 012. `tools.ts` is marked `server-only`,
// which made it unimportable from a plain Node test for three experiments —
// 006, 009 and 010 each recorded `executeTool()` as untested. The resolver hook
// plus `--conditions=react-server` makes it reachable.
import { executeTool, TOOL_DEFINITIONS } from "@/lib/tools";
import { group, ok } from "./harness.mts";

group("tools — definitions");
const names = TOOL_DEFINITIONS.map((t) => t.name);
ok("all three tools are declared", names.length === 3, names.join(", "));
ok("every tool has a description", TOOL_DEFINITIONS.every((t) => (t.description ?? "").length > 40));
ok("every tool declares an object schema",
  TOOL_DEFINITIONS.every((t) => t.input_schema.type === "object"));
ok("descriptions say WHEN to call, not just what (Experiment 006)",
  TOOL_DEFINITIONS.every((t) => /call this|call it|whenever|prefer calling/i.test(t.description ?? "")));

group("tools — calculate");
ok("valid expression", (await executeTool("calculate", { expression: "17*3" })).output === "51");
ok("respects operator precedence", (await executeTool("calculate", { expression: "2+3*4" })).output === "14");
let r = await executeTool("calculate", { expression: "" });
ok("empty expression is an error result, not a throw", r.is_error && r.output.includes("non-empty"));
r = await executeTool("calculate", { expression: 42 });
ok("non-string expression is rejected", r.is_error);
r = await executeTool("calculate", {});
ok("missing expression is rejected", r.is_error);
r = await executeTool("calculate", null);
ok("null input is rejected, not a crash", r.is_error);
r = await executeTool("calculate", { expression: "1".repeat(201) });
ok("expression over 200 chars is rejected", r.is_error && r.output.includes("too long"), r.output);
r = await executeTool("calculate", { expression: "process.env.ANTHROPIC_API_KEY" });
ok("code payload returns an error result", r.is_error, r.output);
r = await executeTool("calculate", { expression: "1/0" });
ok("division by zero is reported, not NaN", r.is_error && r.output.includes("zero"));

group("tools — get_current_time");
r = await executeTool("get_current_time", {});
ok("returns a parseable ISO timestamp", !r.is_error && !Number.isNaN(Date.parse(r.output)), r.output);
ok("ignores unexpected input", !(await executeTool("get_current_time", { junk: 1 })).is_error);

group("tools — unknown tool and error contract");
r = await executeTool("delete_everything", { x: 1 });
ok("an unknown tool is an error RESULT, not a throw", r.is_error && r.output.includes("Unknown tool"), r.output);
ok("the model is told which tool was unknown", r.output.includes("delete_everything"));
