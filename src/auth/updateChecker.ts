import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { isNewer, compareVersions } from '../utils/version';
import { CONTEXT_KEYS } from '../constants';
import { ConfigService } from '../services/configService';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // throttle: at most once/day at startup
const LAST_CHECK_KEY = 'agentStudio.updateChecker.lastCheck';
const DISMISSED_TAG_KEY = 'agentStudio.updateChecker.dismissedTag';
const API = 'https://api.github.com';

interface ReleaseAsset { name: string; url: string; browser_download_url: string; }
interface LatestRelease { tag_name: string; name: string; html_url: string; assets: ReleaseAsset[]; }
/** Optional `latest.json` manifest (spec §7.1) — overrides version + adds force/minimum gates. */
interface UpdateManifest { version?: string; minimumVersion?: string; forceUpdate?: boolean; }

export interface SelfUpdateOpts {
  /** Returns a GitHub token (needed to read PRIVATE repo releases / download private VSIX). */
  getToken?: () => Promise<string | null>;
  /** Bypass the daily throttle (e.g. a manual "Check for updates" command). */
  force?: boolean;
}

async function ghFetch(url: string, accept: string, token: string | null): Promise<Response | null> {
  try {
    const headers: Record<string, string> = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  } catch {
    return null; // network/timeout → treat as "no update available"
  }
}

/**
 * Self-update. Compares the installed version against the configured repo's latest GitHub
 * Release; if newer (or below a manifest `minimumVersion`), AUTO-DOWNLOADS the `.vsix` and
 * installs it when `extensionAutoUpdate` is on (default) — otherwise shows a dismissible
 * toast. Repo + auto-update flag come from ConfigService (env var → setting → default).
 */
export async function enforceLatestVersion(
  context: vscode.ExtensionContext,
  currentVersion: string,
  config: ConfigService,
  opts: SelfUpdateOpts = {},
): Promise<void> {
  if (!opts.force) {
    const last = context.globalState.get<number>(LAST_CHECK_KEY) ?? 0;
    if (Date.now() - last < CHECK_INTERVAL_MS) return;
  }
  await context.globalState.update(LAST_CHECK_KEY, Date.now());

  const repo = config.getExtensionUpdateRepo();
  const token = (await opts.getToken?.()) ?? null;

  const relRes = await ghFetch(`${API}/repos/${repo}/releases/latest`, 'application/vnd.github+json', token);
  if (!relRes || !relRes.ok) return;
  const release = (await relRes.json()) as LatestRelease;

  const manifest = await fetchManifest(repo, token, config.getExtensionUpdateManifestPath());
  const target = (manifest?.version || release.tag_name).replace(/^v/i, '');

  const belowMinimum = manifest?.minimumVersion
    ? compareVersions(currentVersion, manifest.minimumVersion) < 0
    : false;
  if (!isNewer(target, currentVersion) && !belowMinimum) return;

  const auto = config.isExtensionAutoUpdate() || manifest?.forceUpdate === true || belowMinimum;
  if (auto) {
    await downloadAndInstall(context, release, token, currentVersion, target);
    return;
  }

  // Notify-only path (auto-update disabled).
  if (!opts.force && context.globalState.get<string>(DISMISSED_TAG_KEY) === release.tag_name) return;
  const pick = await vscode.window.showInformationMessage(
    `Agent Studio ${release.tag_name} is available (current: v${currentVersion}).`,
    'Update Now', 'Open Release', 'Dismiss',
  );
  if (pick === 'Update Now') await downloadAndInstall(context, release, token, currentVersion, target);
  else if (pick === 'Open Release') vscode.env.openExternal(vscode.Uri.parse(release.html_url));
  else if (pick === 'Dismiss') await context.globalState.update(DISMISSED_TAG_KEY, release.tag_name);
}

async function downloadAndInstall(
  context: vscode.ExtensionContext,
  release: LatestRelease,
  token: string | null,
  currentVersion: string,
  target: string,
): Promise<void> {
  const asset = release.assets?.find((a) => a.name.toLowerCase().endsWith('.vsix'));
  if (!asset) {
    const pick = await vscode.window.showWarningMessage(
      `Agent Studio v${target} is available, but the release has no .vsix to auto-install.`,
      'Open Release',
    );
    if (pick === 'Open Release') vscode.env.openExternal(vscode.Uri.parse(release.html_url));
    return;
  }

  // UI lock flag (when-clauses can hide actions while updating); cleared in finally.
  void vscode.commands.executeCommand('setContext', CONTEXT_KEYS.UPDATING, true);
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Agent Studio: updating to v${target}…`, cancellable: false },
      async (progress) => {
        progress.report({ message: 'Downloading…' });
        // Use the API asset URL + octet-stream so PRIVATE repos work (token-authenticated).
        const res = await ghFetch(asset.url, 'application/octet-stream', token);
        if (!res || !res.ok) throw new Error(`download failed (${res ? res.status : 'network'})`);
        const file = path.join(os.tmpdir(), asset.name);
        await writeFile(file, new Uint8Array(await res.arrayBuffer()));
        progress.report({ message: 'Installing…' });
        await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(file));
      },
    );
    const pick = await vscode.window.showInformationMessage(
      `✅ Agent Studio updated v${currentVersion} → v${target}. Reload to apply.`,
      'Reload Now', 'Later',
    );
    if (pick === 'Reload Now') void vscode.commands.executeCommand('workbench.action.reloadWindow');
  } catch (e) {
    const pick = await vscode.window.showErrorMessage(
      `Agent Studio update failed: ${(e as Error).message}. Update manually from the release page.`,
      'Open Release',
    );
    if (pick === 'Open Release') vscode.env.openExternal(vscode.Uri.parse(release.html_url));
  } finally {
    void vscode.commands.executeCommand('setContext', CONTEXT_KEYS.UPDATING, false);
  }
}

async function fetchManifest(repo: string, token: string | null, manifestPath: string): Promise<UpdateManifest | null> {
  if (!manifestPath) return null;
  const res = await ghFetch(`${API}/repos/${repo}/contents/${manifestPath}`, 'application/vnd.github.raw+json', token);
  if (!res || !res.ok) return null;
  try {
    return JSON.parse(await res.text()) as UpdateManifest;
  } catch {
    return null;
  }
}
