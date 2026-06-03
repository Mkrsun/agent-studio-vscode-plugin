import * as vscode from 'vscode';
import { CONFIG_KEYS, ENV, DEFAULT_UPDATE_REPO } from '../constants';

/** A marketplace descriptor parsed from env / settings: id + label + GitHub repo. */
export interface EnvMarketplace {
  id: string;
  label: string;
  repo: string;
}

export class ConfigService {
  get<T>(key: string): T {
    return vscode.workspace.getConfiguration().get<T>(key) as T;
  }

  getEnabledAssets(): string[] {
    return this.get<string[]>('agentStudio.enabledAssets') ?? [];
  }

  getDisabledAssets(): string[] {
    return this.get<string[]>('agentStudio.disabledAssets') ?? [];
  }

  async setEnabledAssets(ids: string[]): Promise<void> {
    await vscode.workspace
      .getConfiguration()
      .update('agentStudio.enabledAssets', ids, vscode.ConfigurationTarget.Global);
  }

  async setDisabledAssets(ids: string[]): Promise<void> {
    await vscode.workspace
      .getConfiguration()
      .update('agentStudio.disabledAssets', ids, vscode.ConfigurationTarget.Global);
  }

  async enableAsset(id: string): Promise<void> {
    const enabled = new Set(this.getEnabledAssets());
    const disabled = new Set(this.getDisabledAssets());
    enabled.add(id);
    disabled.delete(id);
    await this.setEnabledAssets(Array.from(enabled));
    await this.setDisabledAssets(Array.from(disabled));
  }

  async disableAsset(id: string): Promise<void> {
    const enabled = new Set(this.getEnabledAssets());
    const disabled = new Set(this.getDisabledAssets());
    disabled.add(id);
    enabled.delete(id);
    await this.setEnabledAssets(Array.from(enabled));
    await this.setDisabledAssets(Array.from(disabled));
  }

  isAssetEnabled(id: string, defaultEnabled: boolean): boolean {
    const enabled = this.getEnabledAssets();
    const disabled = this.getDisabledAssets();
    if (disabled.includes(id)) return false;
    if (enabled.includes(id)) return true;
    return defaultEnabled;
  }

  getWorkspaceFolder(): string {
    return this.get<string>('agentStudio.workspaceAssetsFolder') ?? '.agent-studio';
  }

  getRemoteRegistryUrl(): string {
    return this.get<string>('agentStudio.remoteRegistryUrl') ?? '';
  }

  getMaxContextAssets(): number {
    return this.get<number>('agentStudio.maxContextAssets') ?? 5;
  }

  getDefaultWorkflow(): string {
    return this.get<string>('agentStudio.defaultWorkflow') ?? 'full-feature-workflow';
  }

  autoInjectEnabled(): boolean {
    return this.get<boolean>('agentStudio.autoInjectEnabledAssets') ?? true;
  }

  // ── Repos & feature flags ───────────────────────────────────────────────────
  // Resolution order is always: ENV VAR  →  VS Code setting  →  built-in default.
  // (env wins so ops/CI can point a build at different repos without editing settings.)

  /** owner/repo whose GitHub Releases hold the extension's `.vsix` (self-update source). */
  getExtensionUpdateRepo(): string {
    return (
      process.env[ENV.UPDATE_REPO] ||
      this.get<string>(CONFIG_KEYS.EXTENSION_UPDATE_REPO) ||
      DEFAULT_UPDATE_REPO
    );
  }

  /** Optional repo-relative path to a `latest.json` manifest (forceUpdate / minimumVersion). Empty = use Releases only. */
  getExtensionUpdateManifestPath(): string {
    return this.get<string>(CONFIG_KEYS.EXTENSION_UPDATE_MANIFEST) || '';
  }

  /** When true (default), a newer release is auto-downloaded + installed at startup. */
  isExtensionAutoUpdate(): boolean {
    return this.get<boolean>(CONFIG_KEYS.EXTENSION_AUTO_UPDATE) ?? true;
  }

  /** owner/repo of the analytics datastore (consumed by future usage submission). '' = unset. */
  getAnalyticsRepo(): string {
    return (
      process.env[ENV.ANALYTICS_REPO] ||
      this.get<string>(CONFIG_KEYS.ANALYTICS_REPO) ||
      ''
    );
  }

  /** Single-repo env override for the content marketplace (used by MarketplaceService). '' = use settings. */
  getMarketplaceRepoOverride(): string {
    return process.env[ENV.MARKETPLACE_REPO] || '';
  }

  /**
   * Full marketplace list from env (AGENT_STUDIO_MARKETPLACES). Returns [] when
   * unset/empty. Accepts either a JSON array of {id,label,repo} or a comma-list
   * of "id:Label:owner/repo" (label and id optional — see parseMarketplacesEnv).
   * Takes precedence over the single-repo override and over settings.
   */
  getMarketplacesFromEnv(): EnvMarketplace[] {
    return parseMarketplacesEnv(process.env[ENV.MARKETPLACES] || '');
  }

  /** Feature flag: enterprise org-membership gating. OFF by default (any GitHub user passes). */
  requireOrgMembership(): boolean {
    return this.get<boolean>(CONFIG_KEYS.AUTH_REQUIRE_ORG) ?? false;
  }

  /** When true (default), installed assets auto-update to a newer registry version on catalog refresh. */
  isAssetAutoUpdate(): boolean {
    return this.get<boolean>(CONFIG_KEYS.ASSET_AUTO_UPDATE) ?? true;
  }
}

/**
 * Parse the AGENT_STUDIO_MARKETPLACES value into descriptors. Two accepted forms:
 *
 *   JSON array:   [{"id":"chile","label":"Chile","repo":"Org/chile-marketplace"}, …]
 *   Comma-list:   id:Label:owner/repo, id2:Label2:owner/repo2
 *                 - "owner/repo"                  → id+label derived from repo name
 *                 - "id:owner/repo"               → label = id
 *                 - "id:Label:owner/repo"         → all explicit
 *
 * Entries without a valid "owner/repo" are dropped. Always returns an array.
 */
export function parseMarketplacesEnv(raw: string): EnvMarketplace[] {
  const value = raw.trim();
  if (!value) return [];

  if (value.startsWith('[')) {
    try {
      const arr = JSON.parse(value) as Array<Partial<EnvMarketplace>>;
      return arr
        .filter((m): m is EnvMarketplace => !!m && typeof m.repo === 'string' && m.repo.includes('/'))
        .map((m) => ({ id: m.id || repoName(m.repo), label: m.label || m.id || repoName(m.repo), repo: m.repo }));
    } catch {
      return [];
    }
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseMarketplaceEntry)
    .filter((m): m is EnvMarketplace => m !== null);
}

function parseMarketplaceEntry(entry: string): EnvMarketplace | null {
  const parts = entry.split(':').map((p) => p.trim());
  if (parts.length === 1) {
    const repo = parts[0];
    return repo.includes('/') ? { id: repoName(repo), label: repoName(repo), repo } : null;
  }
  if (parts.length === 2) {
    const [id, repo] = parts;
    return repo.includes('/') ? { id, label: id, repo } : null;
  }
  // 3+ parts: id : label : repo  (rejoin any trailing colons into repo, just in case)
  const [id, label, ...rest] = parts;
  const repo = rest.join(':');
  return repo.includes('/') ? { id, label, repo } : null;
}

function repoName(repo: string): string {
  return repo.split('/')[1] ?? repo;
}
