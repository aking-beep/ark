export type ReadingLevel = 'simple' | 'detailed';

export const READING_LEVEL_KEY = 'aifit.readingLevel';

export function parseReadingLevel(value: string | null | undefined): ReadingLevel {
  return value === 'detailed' ? 'detailed' : 'simple';
}
