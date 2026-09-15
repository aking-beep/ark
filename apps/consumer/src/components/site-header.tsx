"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { ReadingLevelToggle } from "@/components/reading-level";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/assessment", label: "Try it" },
  { href: "/methodology", label: "How it works" },
  { href: "/privacy", label: "Privacy" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-border/80 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          MY AI
          <span className="text-primary">.</span>
        </Link>
        <div className="flex items-center gap-2">
          <ReadingLevelToggle />
          <ThemeToggle />
          <nav aria-label="Primary" className="hidden items-center gap-3 text-sm text-muted-foreground md:flex">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={active ? "font-medium text-foreground" : "hover:text-foreground"}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="min-h-11 min-w-11 md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          </Button>
        </div>
      </div>
      {open ? (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-border/80 px-4 py-3 md:hidden">
          <ul className="space-y-1">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`block min-h-11 rounded-lg px-3 py-3 text-sm ${
                      active ? "bg-muted font-medium text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/80 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <p>Free, anonymous, and for anyone. Delete your session anytime.</p>
        <div className="flex gap-4">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/methodology" className="hover:text-foreground">
            How it works
          </Link>
          <a
            href="https://github.com/aking-beep/ark"
            className="hover:text-foreground"
            rel="noreferrer"
            target="_blank"
          >
            Source
          </a>
        </div>
      </div>
    </footer>
  );
}
