'use client';

import { useSyncExternalStore } from 'react';
import { parseReadingLevel, READING_LEVEL_KEY, type ReadingLevel } from '@/lib/reading-level';

let currentLevel: ReadingLevel = 'simple';
let hydrated = false;
const listeners = new Set<() => void>();

function readStorage(): ReadingLevel {
  try {
    return parseReadingLevel(window.localStorage.getItem(READING_LEVEL_KEY));
  } catch {
    return 'simple';
  }
}

function subscribe(listener: () => void): () => void {
  if (!hydrated) {
    hydrated = true;
    currentLevel = readStorage();
  }
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === READING_LEVEL_KEY) {
      currentLevel = readStorage();
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): ReadingLevel {
  return currentLevel;
}

function getServerSnapshot(): ReadingLevel {
  return 'simple';
}

export function setReadingLevel(next: ReadingLevel) {
  currentLevel = next;
  try {
    window.localStorage.setItem(READING_LEVEL_KEY, next);
  } catch {
    // Ignore storage failures; the choice still applies for this visit.
  }
  listeners.forEach((listener) => listener());
}

export function useReadingLevel(): {
  level: ReadingLevel;
  detailed: boolean;
  setLevel: (level: ReadingLevel) => void;
} {
  const level = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { level, detailed: level === 'detailed', setLevel: setReadingLevel };
}

export function ReadingLevelToggle({ className }: { className?: string }) {
  const { level, setLevel } = useReadingLevel();
  const options: { id: ReadingLevel; label: string; hint: string }[] = [
    { id: 'simple', label: 'Simple', hint: 'Plain language, shorter help' },
    { id: 'detailed', label: 'Detailed', hint: 'Full explanation on each question' },
  ];

  return (
    <div
      role="group"
      aria-label="Reading level"
      className={`inline-flex items-center rounded-full border border-border bg-background p-0.5 text-xs ${className ?? ''}`}
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
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
