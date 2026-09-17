"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    await fetch("/api/login", { method: "DELETE" });
    window.location.reload();
  }

  return (
    <Button variant="ghost" onClick={signOut} disabled={busy} className="text-sm">
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
