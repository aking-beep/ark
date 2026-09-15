'use client';

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'aifit.theme';

// Blocking snippet injected before paint so the saved theme applies with
// no flash. No saved choice follows the OS.
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');var dark=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',dark);}catch(e){}})();`;

const listeners = new Set<() => void>();

function isDarkNow(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return isDarkNow();
}

function getServerSnapshot(): boolean {
  return false;
}

export function setDark(dark: boolean) {
  try {
    document.documentElement.classList.toggle('dark', dark);
    window.localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
  } catch {
    // Storage can fail in private mode; the class still applies for this visit.
  }
  listeners.forEach((listener) => listener());
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.75">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 3v2m0 14v2M5 12H3m18 0h-2M6.2 6.2 4.8 4.8m14.4 14.4-1.4-1.4M17.8 6.2l1.4-1.4M6.2 17.8l-1.4 1.4" />
    </svg>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <button
      type="button"
      onClick={() => setDark(!dark)}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`inline-flex size-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:text-foreground ${className ?? ''}`}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
