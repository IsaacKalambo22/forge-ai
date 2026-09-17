import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

import { authRequired, hasValidSession } from "@/lib/guard";
import { PageContainer, TopBar } from "@/components/shell";

import Login from "./login";

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
    >
      <body className="flex min-h-full flex-col bg-background">
        {locked ? (
          <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6">
            <p className="text-sm font-semibold tracking-tight text-foreground">
              Forge AI
            </p>
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
