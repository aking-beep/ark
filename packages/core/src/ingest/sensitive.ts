/**
 * Patterns that indicate regulated or sensitive content left the building.
 *
 * Deliberately conservative and deliberately local — detection runs on the
 * ingest host (or in the SDK before POST) and only the match *labels* are
 * persisted, never the matched text. A control that logs the PII it found in
 * order to warn you about PII is not a control.
 *
 * Every detector is global so `redactSensitiveText` can replace each match in
 * place; `detectSensitive` resets `lastIndex` before every use.
 */
interface Detector {
  label: string;
  re: RegExp;
  /** A second opinion on a regex match, for patterns a regex alone over-matches. */
  accept?: (match: string) => boolean;
}

/**
 * Card numbers are 12–19 digits, optionally grouped by spaces or dashes, and
 * carry a Luhn check digit. The regex alone also matches every 13-digit
 * epoch-millisecond timestamp, so a match must pass Luhn *and* start with a
 * major-industry digit that card networks issue under (2–6: Mastercard 2-series,
 * Amex/Diners/JCB, Visa, Mastercard, Discover/UnionPay). Epoch-ms values start
 * with 1 until 2033, which is what keeps `1728561234567` from being a card.
 */
function isCardNumber(match: string): boolean {
  const digits = match.replace(/[ -]/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  if (!/^[2-6]/.test(digits)) return false;
  return luhn(digits);
}

export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const DETECTORS: Detector[] = [
  { label: 'email', re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g },
  { label: 'us_ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { label: 'credit_card', re: /\b\d(?:[ -]?\d){11,18}\b/g, accept: isCardNumber },
  { label: 'us_phone', re: /\b\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g },
  // Provider credentials. Anthropic (`sk-ant-…`) and OpenAI project/service
  // keys (`sk-proj-…`) carry `-` and `_` in the body, which the generic
  // `sk-…` shape below stops at.
  { label: 'api_key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { label: 'api_key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{16,}/g },
  { label: 'api_key', re: /\b(?:sk|pk|ghp|xox[bp])[-_][A-Za-z0-9]{16,}\b/g },
  // AWS access key ids: long-term (AKIA) and STS session (ASIA).
  { label: 'api_key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // GitHub classic (ghp_/gho_/ghu_/ghs_/ghr_) and fine-grained PATs.
  { label: 'api_key', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { label: 'api_key', re: /\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { label: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g },
];

function matches(d: Detector, text: string): boolean {
  d.re.lastIndex = 0;
  if (!d.accept) return d.re.test(text);
  let m: RegExpExecArray | null;
  while ((m = d.re.exec(text))) {
    if (d.accept(m[0])) return true;
    if (m[0].length === 0) d.re.lastIndex++;
  }
  return false;
}

export function detectSensitive(text: string | undefined | null): string[] {
  if (!text) return [];
  const labels = new Set<string>();
  for (const d of DETECTORS) {
    if (!labels.has(d.label) && matches(d, text)) labels.add(d.label);
  }
  for (const d of DETECTORS) d.re.lastIndex = 0;
  return [...labels];
}

/**
 * Replace every sensitive match in `text` with `[redacted:<label>]`.
 *
 * For fields that are identifiers or operation names rather than payloads —
 * an MCP resource URI, an actor name — dropping the whole value would lose
 * the honest part (`resources/read:`) along with the leak. The replacement
 * markers contain no digits and no `@`, so a second pass changes nothing.
 */
export function redactSensitiveText(text: string): { text: string; labels: string[] } {
  const labels = new Set<string>();
  let out = text;
  for (const d of DETECTORS) {
    d.re.lastIndex = 0;
    out = out.replace(d.re, (m) => {
      if (d.accept && !d.accept(m)) return m;
      labels.add(d.label);
      return `[redacted:${d.label}]`;
    });
    d.re.lastIndex = 0;
  }
  return { text: out, labels: [...labels].sort() };
}
