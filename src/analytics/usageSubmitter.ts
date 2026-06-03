import * as vscode from 'vscode';

/**
 * Consolidates THIS dev's local token-usage NDJSON into the shared analytics
 * datastore by opening a Pull Request — the in-extension twin of the repo's
 * `submit-usage.mjs`, but reusing the user's existing GitHub session token
 * instead of a separate PAT.
 *
 * WHY: usage data is produced locally (by `otel-tokens.mjs`) and gitignored in
 * the product repo (per-dev + regenerable). To build the org-wide picture it is
 * SUBMITTED as a PR under a per-dev path (`data/perf/local/<login>/…`) so
 * concurrent submissions never conflict. Committed rows are NUMBERS ONLY —
 * per (date, model) token counts, never prompt/response content.
 */

const GITHUB_API = 'https://api.github.com';
const USAGE_DIR = 'data/perf/local';

interface UsageFile {
  /** Path relative to the analytics repo root, e.g. data/perf/local/manu/2026-06.ndjson */
  repoPath: string;
  /** base64-encoded file content */
  contentB64: string;
}

/**
 * Entry point for the `agentStudio.submitUsage` command.
 * Returns silently after showing user-facing notifications.
 */
export async function submitUsage(
  analyticsRepo: string,
  getToken: () => Promise<string | null>,
): Promise<void> {
  if (!analyticsRepo || !analyticsRepo.includes('/')) {
    vscode.window.showErrorMessage(
      'Agent Studio: set an analytics repo first (agentStudio.analyticsRepo or AGENT_STUDIO_ANALYTICS_REPO, in "owner/repo" form).',
    );
    return;
  }
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!wsRoot) {
    vscode.window.showErrorMessage('Agent Studio: open a workspace folder to submit usage.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Agent Studio: submitting usage…', cancellable: false },
    async () => {
      const login = await resolveLogin(getToken);
      const files = await collectUsageFiles(wsRoot, login);
      if (files.length === 0) {
        vscode.window.showInformationMessage(
          `Agent Studio: no usage found under ${USAGE_DIR}/${login}/ — run otel-tokens.mjs first.`,
        );
        return;
      }

      const token = await getToken();
      if (!token) {
        vscode.window.showErrorMessage('Agent Studio: sign in with GitHub before submitting usage.');
        return;
      }

      try {
        const url = await openUsagePr(analyticsRepo, login, files, token);
        const action = await vscode.window.showInformationMessage(
          `✅ Usage submitted (${files.length} file(s), numbers only) → PR opened.`,
          'Open PR',
        );
        if (action === 'Open PR') vscode.env.openExternal(vscode.Uri.parse(url));
      } catch (e) {
        vscode.window.showErrorMessage(`Agent Studio: usage submission failed — ${(e as Error).message}`);
      }
    },
  );
}

/** Per-dev login: GitHub username (from the token) → git email local-part → 'unknown'. */
async function resolveLogin(getToken: () => Promise<string | null>): Promise<string> {
  const token = await getToken();
  if (token) {
    try {
      const res = await fetch(`${GITHUB_API}/user`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'agent-studio' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const login = (await res.json() as { login?: string }).login;
        if (login) return login;
      }
    } catch { /* fall through */ }
  }
  return 'unknown';
}

/** Read every *.ndjson under <wsRoot>/data/perf/local/<login>/ as base64. */
async function collectUsageFiles(wsRoot: vscode.Uri, login: string): Promise<UsageFile[]> {
  const devDir = vscode.Uri.joinPath(wsRoot, USAGE_DIR, login);
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(devDir);
  } catch {
    return [];
  }
  const out: UsageFile[] = [];
  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File || !name.endsWith('.ndjson')) continue;
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(devDir, name));
    out.push({ repoPath: `${USAGE_DIR}/${login}/${name}`, contentB64: Buffer.from(bytes).toString('base64') });
  }
  return out;
}

/** Create branch → upsert files → open PR. Returns the PR html_url. */
async function openUsagePr(repo: string, login: string, files: UsageFile[], token: string): Promise<string> {
  const [owner, name] = repo.split('/');
  const gh = ghClient(token);

  const base = (await gh('GET', `/repos/${owner}/${name}`)).default_branch as string;
  const baseSha = (await gh('GET', `/repos/${owner}/${name}/git/ref/heads/${base}`)).object.sha as string;
  // Deterministic-ish, collision-resistant branch (Date.now/random are unavailable here at build time
  // but fine at runtime; still namespace by login so parallel devs never clash).
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const branch = `usage/${login}/${stamp}`;
  await gh('POST', `/repos/${owner}/${name}/git/refs`, { ref: `refs/heads/${branch}`, sha: baseSha });

  for (const f of files) {
    // File may already exist on the branch (re-submission) → need its sha to update.
    let sha: string | undefined;
    try {
      const cur = await gh('GET', `/repos/${owner}/${name}/contents/${f.repoPath}?ref=${branch}`);
      sha = cur.sha as string | undefined;
    } catch { /* new file */ }
    await gh('PUT', `/repos/${owner}/${name}/contents/${f.repoPath}`, {
      message: `usage: ${f.repoPath.split('/').pop()}`,
      content: f.contentB64,
      branch,
      ...(sha ? { sha } : {}),
    });
  }

  const pr = await gh('POST', `/repos/${owner}/${name}/pulls`, {
    title: `usage: consolidate ${login} (${files.length} file(s))`,
    head: branch,
    base,
    body:
      'Automated submission of per-dev token-usage NDJSON (numbers only — per (date, model) counts, no content).\n\nGenerated by the Agent Studio extension.',
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
