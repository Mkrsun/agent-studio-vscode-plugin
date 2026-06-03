import * as vscode from 'vscode';
import { ConfigService } from '../services/configService';
import { AssetLoader } from '../services/assetLoader';
import { ScopeService } from '../services/scopeService';
import { InspectorProvider } from '../inspector/inspectorProvider';
import { registerParticipant } from '../participant/agentParticipant';
import { registerInspectorCommands } from '../inspector/inspectorCommands';
import { MarketplacePanel, MarketplacePreFilter } from '../marketplace/marketplacePanel';
import { CopilotExporter } from '../services/copilotExporter';
import { McpInstaller } from '../marketplace/mcpInstaller';
import { PluginRegistry } from '../marketplace/pluginRegistry';
import { InstalledPluginNode } from '../inspector/inspectorTreeItem';
import { MarketplaceService } from '../marketplace/marketplaceService';
import { autoUpdateAssets } from '../marketplace/assetAutoUpdate';
import { AnalyticsService } from '../analytics/analyticsService';
import { initMetrics } from '../analytics/metrics';
import { COMMANDS, VIEW_IDS } from '../constants';
import { AuthService } from './authService';
import { enforceLatestVersion } from './updateChecker';

/**
 * Registers every feature surface that should exist only for authenticated users
 * and returns the disposables for teardown on sign-out.
 *
 * `authService` is null in dev-bypass mode (no token available).
 */
export function registerAuthenticatedSurface(
  context: vscode.ExtensionContext,
  authService: AuthService | null,
  configService: ConfigService,
): Promise<vscode.Disposable[]> {
  return new AuthenticatedSurface(context, authService, configService).build();
}

/**
 * Owns the services + commands of the authenticated surface. Each command is a
 * named method (not an inline closure), so this file reads as a table of
 * contents in `build()` with the details just below.
 */
class AuthenticatedSurface {
  private readonly getToken: () => Promise<string | null>;
  private readonly marketplace: MarketplaceService;
  private readonly assets: AssetLoader;
  private readonly scopes: ScopeService;
  private readonly exporter: CopilotExporter;
  private readonly mcp: McpInstaller;
  private readonly plugins: PluginRegistry;
  private readonly analytics: AnalyticsService;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly authService: AuthService | null,
    private readonly config: ConfigService,
  ) {
    this.getToken = authService
      ? () => authService.getAccessToken()
      : () => Promise.resolve<string | null>(null);
    this.marketplace = new MarketplaceService(config, this.getToken);
    this.assets = new AssetLoader(context, config, this.marketplace);
    this.scopes = new ScopeService(context);
    this.exporter = new CopilotExporter(this.assets);
    this.mcp = new McpInstaller();
    this.plugins = new PluginRegistry(context);
    this.analytics = new AnalyticsService(context, config, this.getToken);
  }

  /** Self-update, load content, then wire the tree, participant, and commands. */
  async build(): Promise<vscode.Disposable[]> {
    await this.selfUpdate();
    await this.marketplace.initialize();
    await this.loadAndAutoUpdate();

    // Anonymous analytics: facade up first, then start (fail-soft — never throws).
    initMetrics(this.analytics);
    void this.analytics.start();

    const inspector = new InspectorProvider(this.assets, this.scopes, this.plugins, this.mcp, this.marketplace);

    return [
      this.marketplace,
      this.scopes,
      this.analytics,
      this.marketplace.onDidChangeCatalog(() => this.onCatalogChanged()),
      this.createInspectorTree(inspector),
      registerParticipant(this.context, this.assets, this.scopes, this.config, this.authService),
      ...registerInspectorCommands(this.context, this.assets, inspector, this.config, this.scopes, this.exporter, this.marketplace),
      ...this.registerCommands(),
    ];
  }

  // ── Startup steps ───────────────────────────────────────────────────────────

  /** Auto-install a newer VSIX from the update repo (throttled once/day). */
  private async selfUpdate(): Promise<void> {
    const currentVersion =
      (this.context.extension?.packageJSON as { version?: string } | undefined)?.version ?? '0.0.0';
    await enforceLatestVersion(this.context, currentVersion, this.config, { getToken: this.getToken });
  }

  private async loadAndAutoUpdate(): Promise<void> {
    await this.assets.loadAll();
    const updated = this.config.isAssetAutoUpdate()
      ? await autoUpdateAssets(this.assets, this.scopes, this.exporter)
      : 0;
    if (updated > 0) {
      vscode.window.showInformationMessage(`Agent Studio: auto-updated ${updated} asset(s) to the latest version.`);
    }
  }

  /** Reload (and auto-update) whenever a marketplace catalog refreshes. */
  private async onCatalogChanged(): Promise<void> {
    await this.assets.loadAll();
    if (this.config.isAssetAutoUpdate()) {
      await autoUpdateAssets(this.assets, this.scopes, this.exporter);
    }
  }

  private createInspectorTree(provider: InspectorProvider): vscode.Disposable {
    return vscode.window.createTreeView(VIEW_IDS.INSPECTOR, {
      treeDataProvider: provider,
      showCollapseAll: true,
    });
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  private registerCommands(): vscode.Disposable[] {
    return [
      vscode.commands.registerCommand(COMMANDS.OPEN_MARKETPLACE, (f?: MarketplacePreFilter) => this.openMarketplace(f)),
      vscode.commands.registerCommand(COMMANDS.EXPORT_TO_COPILOT, () => this.exportToCopilot()),
      vscode.commands.registerCommand(COMMANDS.SUBMIT_USAGE, () => this.analytics.submitNow()),
      vscode.commands.registerCommand(COMMANDS.INSTALL_PLUGIN, () => this.installPlugin()),
      vscode.commands.registerCommand(COMMANDS.UNINSTALL_PLUGIN, (node?: InstalledPluginNode) => this.uninstallPlugin(node)),
    ];
  }

  private openMarketplace(preFilter?: MarketplacePreFilter): void {
    MarketplacePanel.createOrShow(this.context, this.assets, this.config, this.scopes, this.plugins, this.marketplace, preFilter);
  }

  private exportToCopilot(): Thenable<void> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Agent Studio: Exporting to Copilot…', cancellable: false },
      () => this.runExport(),
    );
  }

  private async runExport(): Promise<void> {
    const repoIds = this.scopes.getRepoScopedIds();
    const result = await this.exporter.exportAll(repoIds.length > 0 ? repoIds : undefined);
    if (!result.ok) {
      vscode.window.showErrorMessage(`Export failed: ${result.error}`);
      return;
    }
    const count = result.written?.length ?? 0;
    const action = await vscode.window.showInformationMessage(
      `✅ Exported ${count} files to .github/ — Copilot will now use your repo-scoped skills, agents, and instructions natively.`,
      'Show Files',
    );
    if (action === 'Show Files') this.revealGithubFolder();
  }

  private revealGithubFolder(): void {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (wsRoot) vscode.commands.executeCommand('revealInExplorer', vscode.Uri.joinPath(wsRoot, '.github'));
  }

  private installPlugin(): void {
    vscode.commands.executeCommand(COMMANDS.OPEN_MARKETPLACE);
    vscode.window.showInformationMessage('Browse plugins in the Marketplace → Plugins tab.');
  }

  private async uninstallPlugin(node?: InstalledPluginNode): Promise<void> {
    const pluginName = node?.record.name ?? (await pickInstalledPlugin(this.plugins));
    if (!pluginName) return;
    await this.plugins.uninstall(pluginName);
    vscode.window.showInformationMessage(
      `🗑 "${pluginName}" uninstalled. The terminal ran \`copilot plugin uninstall ${pluginName}\`.`,
    );
  }
}

/** Quick-pick prompt to choose an installed plugin to uninstall. */
async function pickInstalledPlugin(registry: PluginRegistry): Promise<string | undefined> {
  const installed = registry.getInstalled();
  if (installed.length === 0) {
    vscode.window.showInformationMessage('No plugins installed yet.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    installed.map((p) => ({ label: p.name, description: `v${p.version}`, detail: p.description })),
    { placeHolder: 'Select a plugin to uninstall', matchOnDetail: true },
  );
  return picked?.label;
}
