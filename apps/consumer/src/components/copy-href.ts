/**
 * Clipboard write for the result-page copy control.
 *
 * Extracted so the click behaviour can be tested without mounting React or a
 * browser. The component next to this file is the only UI; this is the bit
 * that has to be true.
 */
export async function copyHref(
  clipboard: { writeText: (s: string) => Promise<void> },
  href: string,
): Promise<void> {
  await clipboard.writeText(href);
}
