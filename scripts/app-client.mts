// A client that drives the running application, and a server to run it against.
//
// Experiment 021. Until now every route has only ever been checked by hand with
// curl — the project had 553 unit assertions and zero end-to-end coverage, so
// nothing verified that the pieces fit together.
//
// This is also what `pnpm verify` needs for the four claims whose evidence comes
// from the app rather than from a direct API call.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readNdjsonStream } from "@/lib/ndjson";
import type { StreamEvent } from "@/lib/messages";

export type Server = {
  url: string;
  secret: string;
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
export async function startServer(port = 3311): Promise<Server> {
  const dir = mkdtempSync(join(tmpdir(), "forge-e2e-"));
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
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`Server did not start within 60s.\n${output.slice(-2000)}`);
    }
    try {
      // Any response at all means it is listening; a 401/404 is still a server.
      await fetch(`${url}/api/metrics`, { signal: AbortSignal.timeout(2000) });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return {
    url,
    secret,
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

export function makeClient(server: Server, cookie: string | null = null): Client {
  const headers = (extra: HeadersInit = {}): HeadersInit => ({
    "Content-Type": "application/json",
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
  const registered = await fetch(`${server.url}/api/login`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${server.secret}` },
    body: JSON.stringify({ username, password }),
  });
  if (registered.status !== 201) {
    throw new Error(`register ${username} failed: ${registered.status} ${await registered.text()}`);
  }

  const login = await fetch(`${server.url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!login.ok) throw new Error(`login ${username} failed: ${login.status}`);

  const setCookie = login.headers.get("set-cookie");
  if (setCookie === null) throw new Error("login returned no Set-Cookie");
  // Only the name=value pair; the attributes are the browser's business.
  const cookie = setCookie.split(";")[0];

  return makeClient(server, cookie);
}
