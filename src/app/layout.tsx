import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";

import { authRequired, hasValidSession } from "@/lib/guard";
import { PageContainer, TopBar } from "@/components/shell";
import { ThemeToggle } from "@/components/theme-toggle";

import Login from "./login";

// Experiment 043. Sets `data-theme` from localStorage BEFORE hydration, so a
// visitor who chose "Dark" does not see a flash of the OS-driven theme (or
// vice versa) on every load. `beforeInteractive` is next/script's strategy
// for exactly this: injected into the server HTML, run before any Next.js
// code, before the page paints. Silently does nothing (leaves data-theme
// unset, `@media (prefers-color-scheme: dark)` still applies) for a visitor
// who never chose — "system" is not stored, only an explicit override is.
const THEME_INIT_SCRIPT = `
  try {
    var t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Forge AI",
  description: "A learning project for AI engineering.",
};

// The lock check happens here, once, for every route — so a new page never
// has to re-derive it, and the nav never advertises a route the visitor
// cannot use yet.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const requestHeaders = await headers();
  const asRequest = new Request("http://local/", { headers: requestHeaders });
  const locked = authRequired() && !hasValidSession(asRequest);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The theme-init script below sets `data-theme` on this element before
      // React hydrates — an intentional mismatch between server and client
      // markup, not a bug, so React is told not to warn about it.
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {locked ? (
          <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold tracking-tight text-foreground">
                Forge AI
              </p>
              <ThemeToggle />
            </div>
            <p className="mt-1.5 mb-8 text-sm text-muted-foreground">
              Chat, retrieval-augmented search and an agent, running against a real
              Claude backend — sign in to use them.
            </p>
            <Login />
          </main>
        ) : (
          <>
            <TopBar />
            <PageContainer>{children}</PageContainer>
          </>
        )}
      </body>
    </html>
  );
}
