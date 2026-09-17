"use client";

import { useState } from "react";

import { Button, ErrorState, Input, Label } from "@/components/ui";

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
    <form onSubmit={submit} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          autoFocus
          required
          placeholder="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? "login-error" : undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? "login-error" : undefined}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      {error && <ErrorState id="login-error" message={error} />}
      {/* Registration is operator-gated on purpose (Experiment 016): an open
          signup on a service that spends money per request is an invitation.
          Saying so here beats leaving a visitor with no account guessing
          why nothing happens. */}
      <p className="text-sm text-muted-foreground">
        No account yet? Ask whoever runs this server to register one for you.
      </p>
    </form>
  );
}
