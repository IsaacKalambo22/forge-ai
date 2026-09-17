import { headers } from "next/headers";
import Link from "next/link";

import { authRequired, currentUserId } from "@/lib/guard";
import { users } from "@/lib/users";

import { NavLinks } from "@/components/nav-links";
import { SignOutButton } from "@/components/sign-out-button";

// Server Component: resolves the signed-in username from the session cookie
// so the browser never has to ask for it separately.
async function CurrentUser() {
  const requestHeaders = await headers();
  const asRequest = new Request("http://local/", { headers: requestHeaders });
  const userId = currentUserId(asRequest);
  if (userId === null) return null;

  const user = users.byId(userId);
  if (user === null) return null;

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">{user.username}</span>
      <SignOutButton />
    </div>
  );
}

export async function TopBar() {
  const showAuthControls = authRequired();

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-sm font-semibold tracking-tight text-foreground">
            Forge AI
          </Link>
          <NavLinks />
        </div>
        {showAuthControls && <CurrentUser />}
      </div>
    </header>
  );
}

export function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      {children}
    </main>
  );
}
