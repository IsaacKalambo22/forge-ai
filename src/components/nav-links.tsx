"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Notebook" },
  { href: "/metrics", label: "Observability" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={
              // min-h-11: the same 44px minimum tap target Button/Input/Select
              // use — this is the one link that gets a visitor anywhere at
              // all, so it is the last place to leave undersized.
              "inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-medium " +
              "transition-colors " +
              (active
                ? "bg-surface text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
