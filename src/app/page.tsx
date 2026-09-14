import Chat from "./chat";
import Search from "./search";

// Server Component: runs only on the server, ships no JavaScript to the browser.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Forge AI</h1>
      <Chat />
      <Search />
    </main>
  );
}
