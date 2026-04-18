import * as vscode from 'vscode';

const REPO = 'MetLife-Global/agent-studio-vscode-plugin';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const LAST_CHECK_KEY = 'agentStudio.updateChecker.lastCheck';
const DISMISSED_TAG_KEY = 'agentStudio.updateChecker.dismissedTag';

interface LatestRelease {
  tag_name: string;
  name: string;
  html_url: string;
}

/**
 * Checks the GitHub Releases API for a newer version of the extension and
 * shows a dismissible toast. Safe to call repeatedly — throttled via
 * globalState so it runs at most once per day.
 */
export async function checkForUpdates(
  context: vscode.ExtensionContext,
  currentVersion: string,
): Promise<void> {
  const lastCheck = context.globalState.get<number>(LAST_CHECK_KEY) ?? 0;
  if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
  await context.globalState.update(LAST_CHECK_KEY, Date.now());

  const release = await fetchLatest();
  if (!release) return;

  const latestVersion = release.tag_name.replace(/^v/, '');
  if (!isNewer(latestVersion, currentVersion)) return;

  const dismissed = context.globalState.get<string>(DISMISSED_TAG_KEY);
  if (dismissed === release.tag_name) return;

  const pick = await vscode.window.showInformationMessage(
    `Agent Studio ${release.tag_name} is available (current: v${currentVersion}). Download from the internal releases page.`,
    'Open Release',
    'Dismiss',
  );
  if (pick === 'Open Release') {
    vscode.env.openExternal(vscode.Uri.parse(release.html_url));
  } else if (pick === 'Dismiss') {
    await context.globalState.update(DISMISSED_TAG_KEY, release.tag_name);
  }
}

async function fetchLatest(): Promise<LatestRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as LatestRelease;
  } catch {
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  const [la, lb, lc] = latest.split('.').map((n) => parseInt(n, 10) || 0);
  const [ca, cb, cc] = current.split('.').map((n) => parseInt(n, 10) || 0);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}
