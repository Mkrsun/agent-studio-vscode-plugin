import * as vscode from 'vscode';
import { CONFIG_KEYS, ENV, DEFAULT_UPDATE_REPO } from '../constants';

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

  /** Feature flag: enterprise org-membership gating. OFF by default (any GitHub user passes). */
  requireOrgMembership(): boolean {
    return this.get<boolean>(CONFIG_KEYS.AUTH_REQUIRE_ORG) ?? false;
  }

  /** When true (default), installed assets auto-update to a newer registry version on catalog refresh. */
  isAssetAutoUpdate(): boolean {
    return this.get<boolean>(CONFIG_KEYS.ASSET_AUTO_UPDATE) ?? true;
  }
}
