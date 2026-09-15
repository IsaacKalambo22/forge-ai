// A client that drives the running application, and a server to run it against.
//
// Experiment 021. Until now every route has only ever been checked by hand with
// curl — the project had 553 unit assertions and zero end-to-end coverage, so
// nothing verified that the pieces fit together.
//
// This is also what `pnpm verify` needs for the four claims whose evidence comes
// from the app rather than from a direct API call.
import { spawn, type ChildProcess } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";

/** How many vectors the shared cache holds — 0 on a first-ever run. */
function cachedVectorCount(): number {
  const path = process.env.FORGE_EMBED_DB_PATH ?? ".data/embeddings.db";
  if (!existsSync(path)) return 0;
  const db = new DatabaseSync(path);
  try {
    return (db.prepare("SELECT COUNT(*) AS n FROM embeddings").get() as { n: number }).n;
  } catch {
    return 0;
  } finally {
    db.close();
  }
}
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readNdjsonStream } from "@/lib/ndjson";
import type { StreamEvent } from "@/lib/messages";

/** A per-run port, so two harnesses cannot collide on a fixed one. */
function randomPort(): number {
  return 3400 + Math.floor(Math.random() * 500);
}

async function somethingIsListening(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

export type Server = {
  url: string;
  secret: string;
  /** Vectors in the shared embedding cache this server will read. */
  seededEmbeddings: number;
  stop(): void;
  /** Everything the server has written to stdout/stderr. */
  log(): string;
};

/**
 * Starts the app on its own port, against its own throwaway database.
 *
 * FORGE_DB_PATH into a temp directory is what keeps a test run from writing
 * into `.data/forge.db` — an end-to-end suite that pollutes the development
 * database is one nobody runs twice.
 */
/**
 * Experiment 025 removed a function that used to live here.
 *
 * It copied cached embeddings row-by-row from the dev database into the test
 * server's, because the two were the same file and the test server needed a
 * throwaway one. That required creating the table before the server had
 * migrated (which broke every request), then forcing the database into
 * existence first (which it had not been).
 *
 * Separating the embedding cache into its own file made all of that
 * unnecessary: the test server keeps a throwaway database for APPLICATION state
 * and simply POINTS AT the shared cache for derived data. Nothing is copied,
 * because nothing needs to be — a content-addressed cache is safe to share, and
 * SQLite's WAL mode handles the concurrent readers.
 *
 * Two bugs deleted rather than fixed.
 */

export async function startServer(port = randomPort()): Promise<Server> {
  const dir = mkdtempSync(join(tmpdir(), "forge-e2e-"));

  // If ANYTHING already answers here, this server will fail to bind and the
  // client would then talk to whatever is already listening — which has a
  // different APP_SECRET, so the failure surfaces as `register alice failed:
  // 401` and points at the auth code. Fail loudly instead.
  if (await somethingIsListening(port)) {
    throw new Error(`Port ${port} is already in use — refusing to start a second server`);
  }
  const secret = `e2e-secret-${Math.random().toString(36).slice(2)}`;
  let output = "";

  // `detached: true` puts the child in its OWN PROCESS GROUP, which is what
  // makes it killable as a group below. Found the hard way — see the note on
  // stop().
  const child: ChildProcess = spawn("npx", ["next", "dev", "--port", String(port)], {
    detached: true,
    env: {
      ...process.env,
      FORGE_DB_PATH: join(dir, "e2e.db"),
      // Application state is throwaway; the embedding cache is shared, because
      // it is derived and identical for everyone running this corpus.
      FORGE_EMBED_DB_PATH: process.env.FORGE_EMBED_DB_PATH ?? ".data/embeddings.db",
      APP_SECRET: secret,
      // Budgets raised so a run cannot trip the Experiment 017 ceiling.
      FORGE_DAILY_BUDGET_USD: "1000",
      FORGE_USER_DAILY_BUDGET_USD: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => { output += String(d); });
  child.stderr?.on("data", (d) => { output += String(d); });

  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    // If the child has already exited, polling for the rest of the minute only
    // delays a failure whose cause is sitting in `output` right now. Report it.
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Server exited during startup (code ${child.exitCode}, signal ${child.signalCode}).\n` +
          output.slice(-2000),
      );
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`Server did not start within 60s.\n${output.slice(-2000)}`);
    }
    try {
      // Any response at all means it is listening; a 401/404 is still a server.
      // Safe here only because the port was verified free before spawning.
      await fetch(`${url}/api/metrics`, { signal: AbortSignal.timeout(2000) });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return {
    url,
    secret,
    seededEmbeddings: cachedVectorCount(),
    /**
     * Kills the whole process GROUP, not just the child.
     *
     * `next dev` spawns a separate `next-server` process. Killing only the
     * direct child leaves that grandchild running and holding the port — and
     * Next then refuses to start another dev server, so the NEXT run fails with
     * a startup timeout that has nothing to do with the code under test.
     *
     * The e2e suite leaked a server process on every run until this was fixed,
     * and reported success while doing it.
     */
    stop() {
      try {
        // Negative pid = the process group, which `detached: true` created.
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL"); // already gone, or no group — fall back
      }
      rmSync(dir, { recursive: true, force: true });
    },
    log: () => output,
  };
}

export type Client = {
  /** Raw request with the session cookie attached. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  json(path: string, body: unknown, method?: string): Promise<{ status: number; body: unknown }>;
  /** POSTs and collects the whole NDJSON stream. */
  stream(path: string, body: unknown): Promise<{ status: number; events: StreamEvent[] }>;
};

/**
 * Each client presents as a distinct caller.
 *
 * Found by a FLAKY GATE: the rate limiter buckets per IP, and every client here
 * arrived with no `x-forwarded-for`, so alice, bob and carol shared one bucket
 * of 20 tokens refilling at 1/3 per second. A suite that runs fast enough
 * exhausts it and starts getting 429s — the same run passed and then failed
 * thirty seconds later, purely on timing.
 *
 * This is not dodging the rate limit. These ARE different callers, and a real
 * deployment behind a proxy is exactly where `x-forwarded-for` is trustworthy
 * (see the warning in guard.ts about where it is not). Presenting them as one
 * address was the unrealistic part.
 */
let callerCount = 0;

export function makeClient(server: Server, cookie: string | null = null): Client {
  const caller = `10.0.0.${++callerCount % 250}`;
  const headers = (extra: HeadersInit = {}): HeadersInit => ({
    "Content-Type": "application/json",
    "X-Forwarded-For": caller,
    ...(cookie === null ? {} : { Cookie: cookie }),
    ...extra,
  });

  return {
    fetch: (path, init = {}) =>
      fetch(`${server.url}${path}`, { ...init, headers: headers(init.headers) }),

    async json(path, body, method = "POST") {
      const response = await fetch(`${server.url}${path}`, {
        method, headers: headers(), body: JSON.stringify(body),
      });
      const text = await response.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep the raw text */ }
      return { status: response.status, body: parsed };
    },

    async stream(path, body) {
      const response = await fetch(`${server.url}${path}`, {
        method: "POST", headers: headers(), body: JSON.stringify(body),
      });
      if (!response.ok || response.body === null) {
        return { status: response.status, events: [] };
      }
      const events: StreamEvent[] = [];
      await readNdjsonStream<StreamEvent>(response.body, (e) => events.push(e));
      return { status: response.status, events };
    },
  };
}

/** Registers a user with the operator secret and returns a logged-in client. */
export async function signIn(
  server: Server,
  username: string,
  password = "an-e2e-test-password",
): Promise<Client> {
  // Register and log in as the same caller the returned client will use, so the
  // whole sign-in flow counts against one bucket rather than the shared one.
  const caller = `10.0.1.${(callerCount + 1) % 250}`;
  const registered = await fetch(`${server.url}/api/login`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": caller,
      Authorization: `Bearer ${server.secret}`,
    },
    body: JSON.stringify({ username, password }),
  });
  if (registered.status !== 201) {
    throw new Error(`register ${username} failed: ${registered.status} ${await registered.text()}`);
  }

  const login = await fetch(`${server.url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": caller },
    body: JSON.stringify({ username, password }),
  });
  if (!login.ok) throw new Error(`login ${username} failed: ${login.status}`);

  const setCookie = login.headers.get("set-cookie");
  if (setCookie === null) throw new Error("login returned no Set-Cookie");
  // Only the name=value pair; the attributes are the browser's business.
  const cookie = setCookie.split(";")[0];

  return makeClient(server, cookie);
}
