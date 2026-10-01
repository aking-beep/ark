import { z } from 'zod';

export const GITHUB_FETCH_LIMITS = {
  maxFiles: 40,
  maxFileBytes: 64_000,
  maxTotalBytes: 512_000,
  maxTreeEntries: 400,
  timeoutMs: 8_000,
  overallMs: 20_000,
} as const;

export const GithubRepoRef = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  branch: z.string().min(1).max(200).optional(),
});
export type GithubRepoRef = z.infer<typeof GithubRepoRef>;

const REPO_RE =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+))?\/?$/;

export function parseGithubRepoUrl(input: string): GithubRepoRef | null {
  const trimmed = input.trim();
  const m = REPO_RE.exec(trimmed);
  if (!m) return null;
  const owner = m[1]!;
  const repo = m[2]!;
  const branch = m[3];
  if (owner === '.' || repo === '.' || owner === '..' || repo === '..') return null;
  return GithubRepoRef.parse({ owner, repo, ...(branch ? { branch } : {}) });
}

export const HIGH_SIGNAL_NAMES = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'readme.md',
  'claude.md',
  'agents.md',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  '.env.example',
  'env.example',
]);

const HIGH_SIGNAL_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.yml', '.yaml', '.toml', '.json', '.md']);

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|vendor)(\/|$)/;

export function isHighSignalPath(filePath: string): boolean {
  const n = filePath.replace(/\\/g, '/');
  if (SKIP_DIR.test(n)) return false;
  if (n.endsWith('.env') && !n.endsWith('.env.example')) return false;
  const base = n.split('/').pop()?.toLowerCase() ?? '';
  if (HIGH_SIGNAL_NAMES.has(base)) return true;
  if (base.includes('mcp') && (base.endsWith('.json') || base.endsWith('.yml'))) return true;
  if (base.includes('agent') && HIGH_SIGNAL_EXT.has(extOf(base))) return true;
  if (base === 'langgraph.json' || base === 'langchain.json') return true;
  return HIGH_SIGNAL_EXT.has(extOf(base)) && /agent|mcp|tool|llm|openai|anthropic/i.test(n);
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

export function selectDiscoveryFiles(
  paths: string[],
  limits = GITHUB_FETCH_LIMITS,
): { selected: string[]; skipped: number; warnings: string[] } {
  const warnings: string[] = [];
  const ranked = paths.filter(isHighSignalPath);
  const skipped = Math.max(0, ranked.length - limits.maxFiles);
  if (paths.length > limits.maxTreeEntries) {
    warnings.push(`Tree listed more than ${limits.maxTreeEntries} entries; extra paths were ignored.`);
  }
  if (skipped > 0) {
    warnings.push(`Capped high-signal files at ${limits.maxFiles}; skipped ${skipped}.`);
  }
  return { selected: ranked.slice(0, limits.maxFiles), skipped, warnings };
}

export interface GithubFileBlob {
  path: string;
  content: string;
}

export interface GithubSnapshot {
  repository: string;
  branch: string;
  commitSha?: string;
  files: GithubFileBlob[];
  warnings: string[];
}

/**
 * Fetch a bounded snapshot. `fetchFn` is injected so tests never hit the network
 * and so the GitHub token stays in the caller (Control server), never here.
 * The token must not be logged.
 */
export async function fetchGithubSnapshot(opts: {
  ref: GithubRepoRef;
  token?: string;
  fetchFn?: typeof fetch;
  limits?: typeof GITHUB_FETCH_LIMITS;
}): Promise<GithubSnapshot> {
  const limits = opts.limits ?? GITHUB_FETCH_LIMITS;
  const deadline = Date.now() + limits.overallMs;
  const fetchFn = opts.fetchFn ?? fetch;
  const { owner, repo } = opts.ref;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'ark-control',
    'x-github-api-version': '2022-11-28',
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  const get = async (url: string) => {
    if (Date.now() > deadline) throw new Error('GitHub fetch exceeded the overall time budget.');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), limits.timeoutMs);
    try {
      const res = await fetchFn(url, { headers, signal: ac.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  const repoRes = await get(`https://api.github.com/repos/${owner}/${repo}`);
  if (repoRes.status === 404) throw new Error('Repository not found or not visible.');
  if (repoRes.status === 401 || repoRes.status === 403) {
    throw new Error('GitHub refused the request. A private repo needs ARK_GITHUB_TOKEN on the server.');
  }
  if (!repoRes.ok) throw new Error(`GitHub repo lookup failed (${repoRes.status}).`);
  const repoJson = (await repoRes.json()) as { default_branch?: string };
  const branch = opts.ref.branch || repoJson.default_branch || 'main';

  const treeRes = await get(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  if (!treeRes.ok) throw new Error(`GitHub tree lookup failed (${treeRes.status}).`);
  const treeJson = (await treeRes.json()) as {
    sha?: string;
    truncated?: boolean;
    tree?: { path?: string; type?: string; size?: number }[];
  };
  const warnings: string[] = [];
  if (treeJson.truncated) warnings.push('GitHub truncated the tree; discovery is incomplete.');
  const paths = (treeJson.tree ?? [])
    .filter((e) => e.type === 'blob' && e.path)
    .slice(0, limits.maxTreeEntries)
    .map((e) => e.path!);
  const { selected, warnings: selectWarnings } = selectDiscoveryFiles(paths, limits);
  warnings.push(...selectWarnings);

  const files: GithubFileBlob[] = [];
  let total = 0;
  for (const filePath of selected) {
    if (Date.now() > deadline) {
      warnings.push(`Stopped fetching at the ${limits.overallMs} ms overall budget.`);
      break;
    }
    if (files.length >= limits.maxFiles) break;
    const contentRes = await get(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replaceAll('%2F', '/')}?ref=${encodeURIComponent(branch)}`,
    );
    if (!contentRes.ok) continue;
    const blob = (await contentRes.json()) as { encoding?: string; content?: string; size?: number };
    if (typeof blob.size === 'number' && blob.size > limits.maxFileBytes) {
      warnings.push(`Skipped ${filePath}: larger than ${limits.maxFileBytes} bytes.`);
      continue;
    }
    let text = '';
    if (blob.encoding === 'base64' && blob.content) {
      text = Buffer.from(blob.content.replace(/\n/g, ''), 'base64').toString('utf8');
    } else if (typeof blob.content === 'string') {
      text = blob.content;
    }
    if (text.length > limits.maxFileBytes) text = text.slice(0, limits.maxFileBytes);
    if (total + text.length > limits.maxTotalBytes) {
      warnings.push(`Stopped fetching at ${limits.maxTotalBytes} total bytes.`);
      break;
    }
    total += text.length;
    files.push({ path: filePath, content: text });
  }

  return {
    repository: `https://github.com/${owner}/${repo}`,
    branch,
    commitSha: treeJson.sha?.slice(0, 40),
    files,
    warnings,
  };
}
