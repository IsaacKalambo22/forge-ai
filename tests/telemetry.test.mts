// Experiment 014.
import { newBuffer, push, snapshot, record, currentSnapshot, resetTelemetry } from "@/lib/telemetry";
import { group, ok, eq, near, throws } from "./harness.mts";

const entry = (route: string, status: number, ms: number) => ({ route, status, ms });

group("telemetry — the ring buffer is bounded");
let b = newBuffer(3);
for (const ms of [1, 2, 3, 4, 5]) b = push(b, entry("chat", 200, ms));
eq("keeps only the newest `capacity` entries", b.entries.map((e) => e.ms), [3, 4, 5]);
eq("but still counts everything ever seen", b.total, 5);
ok("memory cannot grow without bound", b.entries.length <= 3);
throws("capacity must be positive", () => newBuffer(0));
throws("capacity must be an integer", () => newBuffer(1.5));

group("telemetry — push does not mutate");
const before = newBuffer(10);
push(before, entry("chat", 200, 5));
eq("the original is untouched", before.entries.length, 0);

group("telemetry — snapshot groups by route");
let s = newBuffer(100);
s = push(s, entry("chat", 200, 100));
s = push(s, entry("chat", 200, 300));
s = push(s, entry("search", 200, 10));
const snap = snapshot(s);
eq("two routes seen", Object.keys(snap.routes).sort(), ["chat", "search"]);
eq("chat counted separately", snap.routes.chat.count, 2);
eq("search counted separately", snap.routes.search.count, 1);
eq("window size reported", snap.window, 3);
near("chat p50", snap.routes.chat.latency.p50, 100);
near("search p50", snap.routes.search.latency.p50, 10);

group("telemetry — status breakdown");
let t = newBuffer(100);
for (const st of [200, 200, 400, 502]) t = push(t, entry("chat", st, 10));
const stats = snapshot(t).routes.chat;
eq("counts by status", stats.byStatus, { "200": 2, "400": 1, "502": 1 });

group("telemetry — a 400 is not a server error");
// The distinction that keeps the health metric honest: a 400 means the CLIENT
// sent something invalid and the server behaved correctly. Counting it would
// make this project's own alarm ring whenever someone else's script is broken.
near("one 5xx of four requests → 0.25", stats.errorRate, 0.25);
let onlyBadRequests = newBuffer(100);
for (const st of [400, 400, 429]) onlyBadRequests = push(onlyBadRequests, entry("chat", st, 5));
near("all 4xx → error rate 0", snapshot(onlyBadRequests).routes.chat.errorRate, 0);

group("telemetry — total survives eviction");
let evicting = newBuffer(2);
for (let i = 0; i < 10; i++) evicting = push(evicting, entry("chat", 200, i));
const evicted = snapshot(evicting);
eq("window shows what is measurable", evicted.window, 2);
eq("total shows what happened", evicted.total, 10);
ok("so the window is never mistaken for the truth", evicted.total > evicted.window);

group("telemetry — the module-level instance");
resetTelemetry();
eq("starts empty", currentSnapshot().window, 0);
record(entry("ask", 200, 42));
eq("record() reaches the snapshot", currentSnapshot().routes.ask.count, 1);
resetTelemetry();
eq("reset clears it", currentSnapshot().window, 0);
