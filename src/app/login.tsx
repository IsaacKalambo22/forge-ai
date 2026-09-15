"use client";

import { useState } from "react";

/**
 * Credentials are typed here and POSTed once. They are never stored in the
 * browser — what comes back is an HttpOnly cookie the browser sends
 * automatically and this code cannot read. That is the whole point: the browser
 * holds a signed claim, not the secret (Experiments 001, 002, 011).
 *
 * Experiment 016: a username as well as a password. Before that this form asked
 * for one shared password and the resulting session could not say who you were.
 */
export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (response.ok) {
      setPassword("");
      setUsername("");
      // Reload so the server re-renders with the session cookie present.
      window.location.reload();
      return;
    }

    const data = await response.json().catch(() => ({}));
    setError(data.error ?? `Sign-in failed (${response.status})`);
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3">
      <label htmlFor="username" className="text-sm text-zinc-500">
        Sign in to Forge AI.
      </label>
      <input
        id="username"
        name="username"
        autoComplete="username"
        placeholder="Username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <div className="flex gap-2">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="flex-1 rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {busy ? "…" : "Sign in"}
        </button>
      </div>
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
