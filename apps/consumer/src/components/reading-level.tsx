"use client";

import { useSyncExternalStore } from "react";

export type ReadingLevel = "simple" | "detailed";

const STORAGE_KEY = "fit.readingLevel";

// Module-level store read through useSyncExternalStore. This keeps the choice
// in sync across every component and avoids setState-in-effect / hydration
// flashes: the server and first client render both see "simple".
let currentLevel: ReadingLevel = "simple";
let hydrated = false;
const listeners = new Set<() => void>();

function readStorage(): ReadingLevel {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "simple" || stored === "detailed") return stored;
  } catch {
    // Private mode or storage disabled.
  }
  return "simple";
}

function subscribe(listener: () => void): () => void {
  // Hydrate from storage on first subscription (client only).
  if (!hydrated) {
    hydrated = true;
    currentLevel = readStorage();
  }
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      currentLevel = readStorage();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ReadingLevel {
  return currentLevel;
}

function getServerSnapshot(): ReadingLevel {
  return "simple";
}

export function setReadingLevel(next: ReadingLevel) {
  currentLevel = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore storage failures; the choice still applies for this visit.
  }
  listeners.forEach((listener) => listener());
}

export function useReadingLevel(): { level: ReadingLevel; detailed: boolean; setLevel: (level: ReadingLevel) => void } {
  const level = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { level, detailed: level === "detailed", setLevel: setReadingLevel };
}

// Kept as a thin wrapper so the layout can opt future global UI in without
// another refactor. The store itself is module-level, so this is a passthrough.
export function ReadingLevelProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function ReadingLevelToggle({ className }: { className?: string }) {
  const { level, setLevel } = useReadingLevel();
  const options: { id: ReadingLevel; label: string; hint: string }[] = [
    { id: "simple", label: "Simple", hint: "Plain language, no jargon" },
    { id: "detailed", label: "Detailed", hint: "Full technical breakdown" },
  ];

  return (
    <div
      role="group"
      aria-label="Reading level"
      className={`inline-flex items-center rounded-full border border-border bg-background p-0.5 text-xs ${className ?? ""}`}
    >
      {options.map((option) => {
        const active = level === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            title={option.hint}
            onClick={() => setLevel(option.id)}
            className={`rounded-full px-3 py-1 font-medium transition-colors ${
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
