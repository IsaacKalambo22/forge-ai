import { headers } from "next/headers";

import { authRequired, hasValidSession } from "@/lib/guard";

import Ask from "./ask";
import Chat from "./chat";
import Login from "./login";

// A Server Component, so the session check happens on the server and the
// password never reaches the browser in any form.
export default async function Home() {
  const requestHeaders = await headers();
  // `headers()` gives a read-only view; guard's helpers take a Request.
  const asRequest = new Request("http://local/", { headers: requestHeaders });

  const locked = authRequired() && !hasValidSession(asRequest);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Forge AI</h1>
      {locked ? (
        <Login />
      ) : (
        <>
          <Chat />
          <Ask />
        </>
      )}
    </main>
  );
}
