/**
 * Patterns that indicate regulated or sensitive content left the building.
 *
 * Deliberately conservative and deliberately local — detection runs on the
 * ingest host (or in the SDK before POST) and only the match *labels* are
 * persisted, never the matched text. A control that logs the PII it found in
 * order to warn you about PII is not a control.
 */
const DETECTORS: { label: string; re: RegExp }[] = [
  { label: 'email', re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  { label: 'us_ssn', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { label: 'credit_card', re: /\b(?:\d[ -]*?){13,16}\b/ },
  { label: 'us_phone', re: /\b\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/ },
  { label: 'api_key', re: /\b(sk|pk|ghp|xox[bp])[-_][A-Za-z0-9]{16,}\b/ },
  { label: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/ },
];

export function detectSensitive(text: string | undefined | null): string[] {
  if (!text) return [];
  return DETECTORS.filter((d) => d.re.test(text)).map((d) => d.label);
}
