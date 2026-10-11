/**
 * Discover-page helpers. No Next imports, so discover.test.ts runs under
 * plain `node --test`.
 */

/**
 * The only things `/discover?error=` can display. The query string is
 * attacker-controlled — a link can carry any text — so the page maps a code
 * to fixed copy and never renders the parameter itself.
 */
export const DISCOVER_ERRORS = {
  bad_url: 'Use a github.com/owner/repo URL.',
  not_found: 'Repository not found, or not visible to this server.',
  not_public:
    'This server only scans public repositories, and this one is private or does not exist. Private discovery is off unless the operator sets ARK_DISCOVER_ALLOW_PRIVATE=1.',
  refused: 'GitHub refused the request. A private repository needs ARK_GITHUB_TOKEN on the server.',
  timeout: 'GitHub took too long to answer. Try again, or a smaller repository.',
  run_not_found: 'Discovery run not found.',
  candidate_not_found: 'Candidate not in this run.',
  failed: 'Discovery failed.',
} as const;

export type DiscoverErrorCode = keyof typeof DISCOVER_ERRORS;

export function discoverErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(DISCOVER_ERRORS, code)
    ? DISCOVER_ERRORS[code as DiscoverErrorCode]
    : DISCOVER_ERRORS.failed;
}

/** Classify an error thrown by the GitHub fetch into a fixed code. */
export function discoverErrorCode(err: unknown): DiscoverErrorCode {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/not found|not visible/i.test(msg)) return 'not_found';
  if (/refused/i.test(msg)) return 'refused';
  if (/abort|time budget|timed? ?out/i.test(msg)) return 'timeout';
  return 'failed';
}

/**
 * Ask GitHub, without credentials, whether a repository is public.
 *
 * ARK_GITHUB_TOKEN is the server's credential, not the signed-in user's. If
 * discovery used it for any URL a user typed, every tenant could read every
 * private repository that token can see. So unless the operator opts in, the
 * token is only ever used for repositories anyone could read anyway — it buys
 * rate limit, not access.
 */
export async function isPublicRepo(
  owner: string,
  repo: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'ark-control',
          'x-github-api-version': '2022-11-28',
        },
        signal: ac.signal,
      },
    );
    if (!res.ok) return false;
    const json = (await res.json()) as { private?: unknown; visibility?: unknown };
    return json.private === false && (json.visibility === undefined || json.visibility === 'public');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the server token may be used for a user-supplied repository at all. */
export function privateDiscoveryAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.ARK_DISCOVER_ALLOW_PRIVATE === '1';
}
