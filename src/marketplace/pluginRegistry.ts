import * as vscode from 'vscode';
import {
  MarketplaceSource,
  MarketplacePluginEntry,
  MarketplaceIndex,
  InstalledPluginRecord,
  DEFAULT_MARKETPLACES,
} from './pluginTypes';

const INSTALLED_KEY = 'agentStudio.installedPlugins';

/**
 * Manages GitHub Copilot CLI plugins:
 *  - Fetches marketplace.json from known marketplace repos on GitHub
 *  - Tracks installed plugins in workspace state
 *  - Installs via `copilot plugin install <source>` in an integrated terminal
 *  - Uninstalls via `copilot plugin uninstall <name>`
 */
export class PluginRegistry {
  private _installed = new Map<string, InstalledPluginRecord>();
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const saved = context.workspaceState.get<InstalledPluginRecord[]>(INSTALLED_KEY, []);
    for (const record of saved) {
      this._installed.set(record.name, record);
    }
  }

  // ── Marketplace fetching ─────────────────────────────────────────────────

  /**
   * Fetch the marketplace.json index from a single marketplace source.
   * Returns empty array on network/parse error (graceful degradation).
   */
  async fetchMarketplace(src: MarketplaceSource): Promise<MarketplacePluginEntry[]> {
    const branch = src.branch ?? 'main';
    const indexPath = src.indexPath ?? '.github/plugin/marketplace.json';
    const url = `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${branch}/${indexPath}`;

    try {
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as MarketplaceIndex;
      return (data.plugins ?? []).map(p => ({
        ...p,
        // Infer components from fields present in the manifest (best-effort)
        components: p.components ?? this._inferComponents(p),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Fetch all default (+ user-added) marketplaces in parallel.
   * Returns a flat list with the source info attached to each entry.
   */
  async fetchAll(): Promise<Array<MarketplacePluginEntry & { _marketplace: MarketplaceSource }>> {
    const sources = this._getMarketplaceSources();
    const results = await Promise.all(
      sources.map(async src => {
        const plugins = await this.fetchMarketplace(src);
        return plugins.map(p => ({ ...p, _marketplace: src }));
      }),
    );
    return results.flat();
  }

  // ── Install state ────────────────────────────────────────────────────────

  isInstalled(pluginName: string): boolean {
    return this._installed.has(pluginName);
  }

  getInstalled(): InstalledPluginRecord[] {
    return Array.from(this._installed.values());
  }

  getInstalledByName(name: string): InstalledPluginRecord | undefined {
    return this._installed.get(name);
  }

  // ── Installation ─────────────────────────────────────────────────────────

  /**
   * Install a plugin by running `copilot plugin install <source>` in an
   * integrated terminal (requires GitHub Copilot CLI).
   *
   * The source passed to the CLI is the full path within the marketplace repo:
   *   <owner>/<repo>/<source-path>
   *
   * We also record the install locally so the sidebar can show it immediately.
   */
  async install(
    entry: MarketplacePluginEntry,
    marketplace: MarketplaceSource,
  ): Promise<void> {
    const cliSource = `${marketplace.owner}/${marketplace.repo}/${entry.source}`;

    // Run the CLI install in a terminal
    const terminal = vscode.window.createTerminal({
      name: `Plugin: ${entry.name}`,
      iconPath: new vscode.ThemeIcon('plug'),
    });
    terminal.show(false); // don't steal focus
    terminal.sendText(`copilot plugin install ${cliSource}`);

    // Record the install immediately (optimistic UI)
    const record: InstalledPluginRecord = {
      name: entry.name,
      description: entry.description,
      version: entry.version,
      type: entry.type ?? 'plugin',
      marketplaceId: marketplace.id,
      marketplaceRepo: `${marketplace.owner}/${marketplace.repo}`,
      source: entry.source,
      installedAt: new Date().toISOString(),
      components: entry.components ?? this._inferComponents(entry),
      phases: entry.phases,
      generates: entry.generates,
      domains: entry.domains,
      agentCount: entry.agentCount,
    };
    this._installed.set(entry.name, record);
    await this._save();
    this._onDidChange.fire();
  }

  /**
   * Install from a GitHub repo URL or a local path.
   *   copilot plugin install owner/repo
   *   copilot plugin install ./path/to/plugin
   */
  async installCustom(source: string): Promise<void> {
    const name = source.split('/').pop() ?? source;
    const terminal = vscode.window.createTerminal({
      name: `Plugin: ${name}`,
      iconPath: new vscode.ThemeIcon('plug'),
    });
    terminal.show(false);
    terminal.sendText(`copilot plugin install ${source}`);

    // Record a minimal entry
    const record: InstalledPluginRecord = {
      name,
      description: `Installed from ${source}`,
      version: 'unknown',
      type: 'plugin',
      marketplaceId: 'custom',
      marketplaceRepo: source,
      source,
      installedAt: new Date().toISOString(),
      components: [],
    };
    this._installed.set(name, record);
    await this._save();
    this._onDidChange.fire();
  }

  async uninstall(pluginName: string): Promise<void> {
    const terminal = vscode.window.createTerminal({
      name: `Plugin: uninstall ${pluginName}`,
      iconPath: new vscode.ThemeIcon('trash'),
    });
    terminal.show(false);
    terminal.sendText(`copilot plugin uninstall ${pluginName}`);

    this._installed.delete(pluginName);
    await this._save();
    this._onDidChange.fire();
  }

  // ── Marketplace sources ───────────────────────────────────────────────────

  getMarketplaceSources(): MarketplaceSource[] {
    return this._getMarketplaceSources();
  }

  async addMarketplace(src: MarketplaceSource): Promise<void> {
    const custom = this.context.workspaceState.get<MarketplaceSource[]>('agentStudio.customMarketplaces', []);
    custom.push(src);
    await this.context.workspaceState.update('agentStudio.customMarketplaces', custom);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _getMarketplaceSources(): MarketplaceSource[] {
    const custom = this.context.workspaceState.get<MarketplaceSource[]>('agentStudio.customMarketplaces', []);
    return [...DEFAULT_MARKETPLACES, ...custom];
  }

  private async _save(): Promise<void> {
    await this.context.workspaceState.update(
      INSTALLED_KEY,
      Array.from(this._installed.values()),
    );
  }

  private _inferComponents(entry: Partial<MarketplacePluginEntry>): Array<'agents' | 'skills' | 'hooks' | 'mcp' | 'lsp'> {
    // Can't infer without the actual plugin.json, return empty until manifest is fetched
    return [];
  }
}
