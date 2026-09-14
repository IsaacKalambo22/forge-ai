import { decide, MAX_STEPS, REPEAT_LIMIT, type AgentStep } from "@/lib/agent";
import { eq, group } from "./harness.mts";

const step = (calls: string[], finished = false): AgentStep => ({ calls, finished });

group("agent — stopping policy");
eq("no steps yet → continue", decide([]), { action: "continue" });
eq("model finished → done", decide([step([], true)]), { action: "stop", reason: "done" });
eq("one tool step → continue", decide([step(["search:a"])]), { action: "continue" });
eq("two different steps → continue", decide([step(["search:a"]), step(["search:b"])]), { action: "continue" });

group("agent — loop detection");
eq(`same call ×${REPEAT_LIMIT} → no_progress`,
  decide([step(["search:a"]), step(["search:a"])]), { action: "stop", reason: "no_progress" });
eq("repeat broken by a different step → continue",
  decide([step(["search:a"]), step(["search:b"]), step(["search:a"])]), { action: "continue" });
eq("fingerprint is order-independent",
  decide([step(["a", "b"]), step(["b", "a"])]), { action: "stop", reason: "no_progress" });
eq("repeated empty call set is still no_progress",
  decide([step([]), step([])]), { action: "stop", reason: "no_progress" });

group("agent — budget and priority");
const distinct = Array.from({ length: MAX_STEPS }, (_, i) => step([`search:${i}`]));
eq(`${MAX_STEPS} distinct steps → budget`, decide(distinct), { action: "stop", reason: "budget" });
eq(`${MAX_STEPS - 1} distinct steps → continue`, decide(distinct.slice(0, -1)), { action: "continue" });
eq("done wins over budget", decide([...distinct.slice(0, -1), step([], true)]), { action: "stop", reason: "done" });
eq("no_progress fires before budget", decide([step(["x"]), step(["x"])]), { action: "stop", reason: "no_progress" });
