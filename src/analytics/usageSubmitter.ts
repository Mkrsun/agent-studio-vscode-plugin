/**
 * Pure GitHub plumbing to push anonymous metric NDJSON to the analytics datastore
 * as a Pull Request — reusing the user's GitHub session token (no PAT, no Actions,
 * no `gh` CLI). Files land under a per-dev path keyed by the anonymous `devId`.
 *
 * Committed rows are NUMBERS ONLY (counts + coarse tags) and carry no name/login —
 * see metricsCollector. Orchestration (when/what to push) lives in AnalyticsService.
 */

const GITHUB_API = 'https://api.github.com';
const USAGE_DIR = 'data/perf/local';

export interface UsageFile {
  /** File name only, e.g. "2026-06.ndjson". */
  name: string;
  /** base64-encoded file content. */
  contentB64: string;
}

/** Create a branch → upsert each file under data/perf/local/<devId>/ → open a PR. Returns the PR URL. */
export async function pushUsageFiles(
  repo: string,
  devId: string,
  files: UsageFile[],
  token: string,
): Promise<string> {
  const [owner, name] = repo.split('/');
  const gh = ghClient(token);

  const base = (await gh('GET', `/repos/${owner}/${name}`)).default_branch as string;
  const baseSha = (await gh('GET', `/repos/${owner}/${name}/git/ref/heads/${base}`)).object.sha as string;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const branch = `usage/${devId}/${stamp}`;
  await gh('POST', `/repos/${owner}/${name}/git/refs`, { ref: `refs/heads/${branch}`, sha: baseSha });

  for (const f of files) {
    const repoPath = `${USAGE_DIR}/${devId}/${f.name}`;
    let sha: string | undefined;
    try {
      sha = (await gh('GET', `/repos/${owner}/${name}/contents/${repoPath}?ref=${branch}`)).sha as string | undefined;
    } catch { /* new file */ }
    await gh('PUT', `/repos/${owner}/${name}/contents/${repoPath}`, {
      message: `usage: ${f.name}`,
      content: f.contentB64,
      branch,
      ...(sha ? { sha } : {}),
    });
  }

  const pr = await gh('POST', `/repos/${owner}/${name}/pulls`, {
    title: `usage: anonymous metrics (${files.length} file(s))`,
    head: branch,
    base,
    body:
      'Automated submission of anonymous Agent Studio metrics (numbers + coarse tags only — ' +
      'no name/login/email, no prompt/response content). Keyed by an anonymous devId.',
  });
  return pr.html_url as string;
}

/** Minimal GitHub JSON client over fetch; throws on non-2xx with the API message. */
function ghClient(token: string) {
  return async (method: string, path: string, body?: unknown): Promise<Record<string, any>> => {
    const res = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'agent-studio',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${json?.message ?? res.statusText}`);
    return json ?? {};
  };
}
