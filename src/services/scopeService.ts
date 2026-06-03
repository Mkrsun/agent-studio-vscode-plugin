import * as vscode from 'vscode';

export type AssetScope = 'disabled' | 'session' | 'repo';

/**
 * Manages two-level asset activation:
 *
 *  session  → stored in memory only; cleared when VS Code closes.
 *             Assets are injected into @agent-studio context but NOT
 *             written to .github/.
 *
 *  repo     → persisted in VS Code workspace settings.
 *             Assets are injected into @agent-studio AND exported to
 *             .github/ so all Copilot features use them permanently.
 *
 *  disabled → not injected, not exported.
 */
export class ScopeService {
  /** In-memory only — cleared on restart. */
  private _sessionScoped = new Set<string>();

  constructor(private readonly _context: vscode.ExtensionContext) {
    // Restore repo-scoped ids from workspace state so they survive reloads
    // (settings.json is the source of truth; this is just a fast cache)
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  getScope(assetId: string): AssetScope {
    if (this._sessionScoped.has(assetId)) return 'session';
    if (this._getRepoScoped().includes(assetId)) return 'repo';
    return 'disabled';
  }

  getSessionScopedIds(): string[] {
    return Array.from(this._sessionScoped);
  }

  getRepoScopedIds(): string[] {
    return this._getRepoScoped();
  }

  /** All active asset ids (session + repo). */
  getActiveIds(): string[] {
    return [...this._sessionScoped, ...this._getRepoScoped()];
  }

  isActive(assetId: string): boolean {
    return this._sessionScoped.has(assetId) || this._getRepoScoped().includes(assetId);
  }

  // ── Setters ──────────────────────────────────────────────────────────────

  async setScope(assetId: string, scope: AssetScope): Promise<void> {
    // Remove from both first, then add to the requested scope
    this._sessionScoped.delete(assetId);
    await this._removeFromRepo(assetId);

    if (scope === 'session') {
      this._sessionScoped.add(assetId);
    } else if (scope === 'repo') {
      await this._addToRepo(assetId);
    }
    // 'disabled' → already removed above

    this._onDidChange.fire(assetId);
  }

  async activateForSession(assetId: string): Promise<void> {
    return this.setScope(assetId, 'session');
  }

  async activateForRepo(assetId: string): Promise<void> {
    return this.setScope(assetId, 'repo');
  }

  async deactivate(assetId: string): Promise<void> {
    return this.setScope(assetId, 'disabled');
  }

  /** Promote all session-scoped assets to repo scope. */
  async promoteSessionToRepo(): Promise<void> {
    const ids = Array.from(this._sessionScoped);
    for (const id of ids) {
      await this.setScope(id, 'repo');
    }
    this._onDidChange.fire('*');
  }

  /** Clear all session-scoped assets. */
  clearSession(): void {
    this._sessionScoped.clear();
    this._onDidChange.fire('*');
  }

  // ── Change event ─────────────────────────────────────────────────────────

  private _onDidChange = new vscode.EventEmitter<string>();
  readonly onDidChangeScope = this._onDidChange.event;

  dispose(): void {
    this._onDidChange.dispose();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _getRepoScoped(): string[] {
    return vscode.workspace.getConfiguration().get<string[]>('agentStudio.repoScopedAssets') ?? [];
  }

  private async _addToRepo(assetId: string): Promise<void> {
    const current = new Set(this._getRepoScoped());
    current.add(assetId);
    await vscode.workspace.getConfiguration().update(
      'agentStudio.repoScopedAssets',
      Array.from(current),
      vscode.ConfigurationTarget.Workspace,  // workspace-level, not global
    );
  }

  private async _removeFromRepo(assetId: string): Promise<void> {
    const current = new Set(this._getRepoScoped());
    if (!current.has(assetId)) return;
    current.delete(assetId);
    await vscode.workspace.getConfiguration().update(
      'agentStudio.repoScopedAssets',
      Array.from(current),
      vscode.ConfigurationTarget.Workspace,
    );
  }

  // ── Installed-version tracking (per workspace) — drives update detection ─────
  private static readonly _VERS_KEY = 'agentStudio.installedAssetVersions';

  private _versions(): Record<string, string> {
    return this._context.workspaceState.get<Record<string, string>>(ScopeService._VERS_KEY) ?? {};
  }

  /** The version recorded when this asset was last installed/updated (undefined if never). */
  getInstalledVersion(assetId: string): string | undefined {
    return this._versions()[assetId];
  }

  async setInstalledVersion(assetId: string, version: string): Promise<void> {
    await this._context.workspaceState.update(ScopeService._VERS_KEY, {
      ...this._versions(),
      [assetId]: version,
    });
  }

  async clearInstalledVersion(assetId: string): Promise<void> {
    const v = this._versions();
    if (v[assetId] === undefined) return;
    delete v[assetId];
    await this._context.workspaceState.update(ScopeService._VERS_KEY, v);
  }

  // ── Per-asset auto-update preference (per workspace) — OFF by default ────────
  private static readonly _AUTO_KEY = 'agentStudio.assetAutoUpdate';

  private _autoUpdates(): Record<string, boolean> {
    return this._context.workspaceState.get<Record<string, boolean>>(ScopeService._AUTO_KEY) ?? {};
  }

  /** Whether this asset auto-updates to newer registry versions. Default: false. */
  getAutoUpdate(assetId: string): boolean {
    return this._autoUpdates()[assetId] === true;
  }

  async setAutoUpdate(assetId: string, enabled: boolean): Promise<void> {
    await this._context.workspaceState.update(ScopeService._AUTO_KEY, {
      ...this._autoUpdates(),
      [assetId]: enabled,
    });
  }
}

export const SCOPE_ICONS: Record<AssetScope, string> = {
  disabled: 'circle-slash',
  session: 'zap',        // lightning = fast/temporary
  repo:    'repo',       // repo = permanent
};

export const SCOPE_COLORS: Record<AssetScope, string> = {
  disabled: 'disabledForeground',
  session:  'charts.yellow',
  repo:     'testing.iconPassed',
};

export const SCOPE_LABELS: Record<AssetScope, string> = {
  disabled: 'Disabled',
  session:  'Session',
  repo:     'Repo (permanent)',
};
