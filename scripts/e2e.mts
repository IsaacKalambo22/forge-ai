// Experiment 021 — the project's first end-to-end suite. `pnpm e2e`.
//
// Every route here has, until now, only ever been checked by hand with curl.
// 553 unit assertions verified the pieces; nothing verified that they fit
// together. Everything below runs WITHOUT an API credential — it exercises the
// code this project wrote, as opposed to the model's behaviour.
import { startServer, makeClient, signIn } from "./app-client.mts";
import { group, ok, eq, report, exitCode } from "../tests/harness.mts";

console.log("forge-ai — end-to-end\n  starting a server on its own database…");
const server = await startServer();

try {
  const anon = makeClient(server);

  group("e2e — the server is up and closed to anonymous callers");
  eq("an unauthenticated paid route is refused",
    (await anon.json("/api/chat", { message: "hello" })).status, 401);
  eq("so is the free one — free is not public",
    (await anon.json("/api/search", { query: "agent" })).status, 401);
  eq("and metrics", (await anon.fetch("/api/metrics")).status, 401);

  group("e2e — registration requires the operator secret");
  eq("without it", (await anon.json("/api/login",
    { username: "mallory", password: "a-long-enough-password" }, "PUT")).status, 401);

  group("e2e — a registered user can sign in and work");
  const alice = await signIn(server, "alice");
  const search = await alice.json("/api/search", { query: "why is my agent looping forever" });
  eq("search succeeds", search.status, 200);
  const results = (search.body as { results?: { item: { id: string } }[] }).results ?? [];
  ok("and returns ranked lessons", results.length > 0, `${results.length} results`);
  ok("the top hit is the capped-loop lesson",
    results[0]?.item.id === "006-cap-the-loop", results[0]?.item.id);

  group("e2e — validation, over real HTTP");
  eq("empty message", (await alice.json("/api/chat", { message: "" })).status, 400);
  eq("missing message", (await alice.json("/api/chat", {})).status, 400);
  eq("non-string message", (await alice.json("/api/chat", { message: 42 })).status, 400);
  eq("unknown persona", (await alice.json("/api/chat",
    { message: "hi", persona: "pirate" })).status, 400);
  eq("unknown conversation is 404", (await alice.json("/api/chat",
    { conversation_id: "11111111-2222-3333-4444-555555555555", message: "hi" })).status, 404);
  eq("a GET to a POST-only route is 405", (await alice.fetch("/api/chat")).status, 405);

  group("e2e — every response carries a correlation id (Experiment 014)");
  const withId = await alice.fetch("/api/search",
    { method: "POST", body: JSON.stringify({ query: "tokens" }) });
  const requestId = withId.headers.get("x-request-id");
  ok("X-Request-Id is present", requestId !== null, requestId ?? "(none)");
  ok("and is 8 grep-safe characters", /^[a-z0-9]{8}$/.test(requestId ?? ""), requestId ?? "");

  group("e2e — a conversation is created and persisted (Experiment 015)");
  // The model call fails without a credential, but the conversation, its id and
  // the user's turn are all this project's own code and must still work.
  const first = await alice.stream("/api/chat", { message: "my first question" });
  eq("the stream opens with HTTP 200", first.status, 200);
  const opened = first.events.find((e) => e.type === "conversation");
  ok("a conversation id arrives before any model output", opened !== undefined);
  const conversationId = (opened as { id: string } | undefined)?.id ?? "";
  ok("it is a uuid", /^[0-9a-f-]{36}$/.test(conversationId), conversationId);
  ok("the model call fails, and says so in-stream, on a 200",
    first.events.some((e) => e.type === "error"));

  eq("the same conversation can be continued",
    (await alice.stream("/api/chat",
      { conversation_id: conversationId, message: "a follow-up" })).status, 200);

  group("e2e — AUTHORIZATION across two real users (Experiment 016)");
  const bob = await signIn(server, "bob");
  const bobTries = await bob.json("/api/chat",
    { conversation_id: conversationId, message: "let me see that" });
  const bobFake = await bob.json("/api/chat",
    { conversation_id: "99999999-9999-9999-9999-999999999999", message: "x" });
  eq("bob gets 404 for alice's real conversation", bobTries.status, 404);
  eq("and 404 for one that never existed", bobFake.status, 404);
  eq("the two responses are byte-identical — a 403 would confirm the id is real",
    JSON.stringify(bobTries.body), JSON.stringify(bobFake.body));
  eq("analyse is protected the same way", (await bob.json("/api/analyze",
    { conversation_id: conversationId })).status, 404);

  group("e2e — logout revokes the session (Experiment 015)");
  const carol = await signIn(server, "carol");
  eq("carol can search", (await carol.json("/api/search", { query: "x" })).status, 200);
  eq("logout succeeds", (await carol.fetch("/api/login", { method: "DELETE" })).status, 200);
  eq("the same cookie is now refused", (await carol.json("/api/search", { query: "x" })).status, 401);

  group("e2e — the notebook index reports readiness instead of waiting (Experiment 024)");
  // Before 024 a cold /api/ask simply blocked — measured at 196.8s with an empty
  // cache, and 516.6s before batching. A silent multi-minute wait is
  // indistinguishable from a hang.
  ok("the test server was seeded with cached embeddings", server.seededEmbeddings > 0,
    `${server.seededEmbeddings} vectors copied from the dev cache`);

  // Use fetch() rather than json(), so the status, body and HEADERS all come
  // from the SAME response. Checking Retry-After on a follow-up request is a
  // race: by then the index may be ready and the header legitimately absent.
  const firstAsk = await alice.fetch("/api/ask", {
    method: "POST", body: JSON.stringify({ question: "what is prompt injection?" }),
  });
  const firstBody = await firstAsk.text();
  // The first caller triggers the build and is told so, rather than queuing.
  ok("the first request is answered, not hung",
    firstAsk.status === 503 || firstAsk.status === 200, `HTTP ${firstAsk.status}`);
  if (firstAsk.status === 503) {
    ok("with an honest error", firstBody.includes("still building"), firstBody.slice(0, 80));
    ok("and a Retry-After header on that same response",
      firstAsk.headers.get("retry-after") !== null,
      firstAsk.headers.get("retry-after") ?? "(none)");
  }

  // Wait for the build, then confirm the route actually works.
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    // A connection can drop while the server is busy building; that is not a
    // failure of the thing under test, so retry rather than abort the suite.
    const probe = await alice
      .stream("/api/ask", { question: "what is prompt injection?" })
      .catch(() => ({ status: 0, events: [] as never[] }));
    if (probe.status === 200) {
      ready = true;
      const sources = probe.events.find((e) => e.type === "sources");
      ok("once ready, retrieval runs and sources are emitted", sources !== undefined);
      ok("the passages come from the notebook",
        ((sources as { sources?: { file: string }[] } | undefined)?.sources ?? []).length > 0);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  ok("the index became ready within 60s of a seeded cache", ready);

  group("e2e — the server logged structured JSON throughout (Experiment 014)");
  const lines = server.log().split("\n").filter((l) => l.startsWith('{"level"'));
  ok("structured log lines were written", lines.length > 0, `${lines.length} lines`);
  ok("each parses as JSON", lines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));
  ok("and carries a request_id",
    lines.filter((l) => JSON.parse(l).request_id !== undefined).length > 0);
  ok("no secret ever reached the log", !server.log().includes(server.secret));
  ok("nor any password", !server.log().includes("an-e2e-test-password"));
} finally {
  server.stop();
}

report();
process.exit(exitCode());
