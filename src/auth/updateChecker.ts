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
const VSIX_RE = /agent-studio-(\d+\.\d+\.\d+)\.vsix$/i;

/** A `.vsix` file found in the update folder. `url` is the contents-API URL (raw-downloadable). */
interface VsixEntry { name: string; version: string; url: string; }
/** Optional `latest.json` manifest — overrides the picked version + adds force/minimum gates. */
interface UpdateManifest { version?: string; minimumVersion?: string; forceUpdate?: boolean; }

export interface SelfUpdateOpts {
  /** Returns a GitHub token (only needed if the update repo is PRIVATE). */
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
 * Self-update from a FOLDER channel. Lists the `.vsix` files committed under the update repo's
 * update directory (default `updates/`) on the configured branch, picks the highest version, and
 * — if newer than what's installed (or below a manifest `minimumVersion`) — AUTO-DOWNLOADS and
 * installs it when `extensionAutoUpdate` is on (default). Otherwise shows a dismissible toast.
 * Repo / dir / branch / auto-update flag all come from ConfigService (env → setting → default).
 *
 * Publish a new version simply by committing `updates/agent-studio-X.Y.Z.vsix` to that branch.
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
  const dir = config.getExtensionUpdateDir();
  const branch = config.getExtensionUpdateBranch();
  const token = (await opts.getToken?.()) ?? null;
  const browseUrl = `https://github.com/${repo}/tree/${branch || 'HEAD'}/${dir}`;

  const entries = await listVsix(repo, dir, branch, token);
  const latest = pickLatest(entries);

  const manifest = await fetchManifest(repo, branch, token, config.getExtensionUpdateManifestPath());
  const target = (manifest?.version || latest?.version || '').replace(/^v/i, '');
  if (!target) {
    if (opts.force) void vscode.window.showWarningMessage(`Agent Studio: no .vsix found under ${repo}/${dir}.`);
    return;
  }

  const belowMinimum = manifest?.minimumVersion
    ? compareVersions(currentVersion, manifest.minimumVersion) < 0
    : false;
  if (!isNewer(target, currentVersion) && !belowMinimum) {
    if (opts.force) void vscode.window.showInformationMessage(`Agent Studio is up to date (v${currentVersion}).`);
    return;
  }

  // The asset to install: the manifest may pin a version, so re-resolve against the listing.
  const asset = entries.find((e) => e.version === target) ?? latest;
  if (!asset) {
    const pick = await vscode.window.showWarningMessage(
      `Agent Studio v${target} is published but its .vsix isn't in ${dir}/ yet.`,
      'Open Folder',
    );
    if (pick === 'Open Folder') void vscode.env.openExternal(vscode.Uri.parse(browseUrl));
    return;
  }

  const auto = config.isExtensionAutoUpdate() || manifest?.forceUpdate === true || belowMinimum;
  if (auto) {
    await downloadAndInstall(context, asset, token, currentVersion, target, browseUrl);
    return;
  }

  // Notify-only path (auto-update disabled).
  if (!opts.force && context.globalState.get<string>(DISMISSED_TAG_KEY) === target) return;
  const pick = await vscode.window.showInformationMessage(
    `Agent Studio v${target} is available (current: v${currentVersion}).`,
    'Update Now', 'Open Folder', 'Dismiss',
  );
  if (pick === 'Update Now') await downloadAndInstall(context, asset, token, currentVersion, target, browseUrl);
  else if (pick === 'Open Folder') void vscode.env.openExternal(vscode.Uri.parse(browseUrl));
  else if (pick === 'Dismiss') await context.globalState.update(DISMISSED_TAG_KEY, target);
}

/** List `agent-studio-X.Y.Z.vsix` files in the repo's update directory (GitHub contents API). */
async function listVsix(repo: string, dir: string, branch: string, token: string | null): Promise<VsixEntry[]> {
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const res = await ghFetch(`${API}/repos/${repo}/contents/${dir}${ref}`, 'application/vnd.github+json', token);
  if (!res || !res.ok) return [];
  let items: unknown;
  try { items = await res.json(); } catch { return []; }
  if (!Array.isArray(items)) return [];
  const out: VsixEntry[] = [];
  for (const it of items as Array<{ name?: string; type?: string; url?: string }>) {
    if (it.type !== 'file' || !it.name || !it.url) continue;
    const m = VSIX_RE.exec(it.name);
    if (m) out.push({ name: it.name, version: m[1], url: it.url });
  }
  return out;
}

/** Highest-versioned entry, or null when the folder has no .vsix. */
function pickLatest(entries: VsixEntry[]): VsixEntry | null {
  return entries.reduce<VsixEntry | null>((best, e) => (!best || isNewer(e.version, best.version) ? e : best), null);
}

async function downloadAndInstall(
  context: vscode.ExtensionContext,
  asset: VsixEntry,
  token: string | null,
  currentVersion: string,
  target: string,
  browseUrl: string,
): Promise<void> {
  // UI lock flag (when-clauses can hide actions while updating); cleared in finally.
  void vscode.commands.executeCommand('setContext', CONTEXT_KEYS.UPDATING, true);
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Agent Studio: updating to v${target}…`, cancellable: false },
      async (progress) => {
        progress.report({ message: 'Downloading…' });
        // contents-API URL + raw media type → returns the file bytes (works for private repos too).
        const res = await ghFetch(asset.url, 'application/vnd.github.raw', token);
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
      `Agent Studio update failed: ${(e as Error).message}. Update manually from the update folder.`,
      'Open Folder',
    );
    if (pick === 'Open Folder') void vscode.env.openExternal(vscode.Uri.parse(browseUrl));
  } finally {
    void vscode.commands.executeCommand('setContext', CONTEXT_KEYS.UPDATING, false);
  }
}

async function fetchManifest(repo: string, branch: string, token: string | null, manifestPath: string): Promise<UpdateManifest | null> {
  if (!manifestPath) return null;
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const res = await ghFetch(`${API}/repos/${repo}/contents/${manifestPath}${ref}`, 'application/vnd.github.raw', token);
  if (!res || !res.ok) return null;
  try {
    return JSON.parse(await res.text()) as UpdateManifest;
  } catch {
    return null;
  }
}
