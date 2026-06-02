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
import { AssetInstaller } from '../marketplace/installer';
import { MarketplaceService } from '../marketplace/marketplaceService';
import { COMMANDS, VIEW_IDS } from '../constants';
import { AuthService } from './authService';
import { enforceLatestVersion } from './updateChecker';

/**
 * Registers all feature surfaces that should exist only for authenticated users.
 * Returns the disposables for teardown on sign-out.
 *
 * `authService` may be null when the extension runs in dev-bypass mode.
 */
export async function registerAuthenticatedSurface(
  context: vscode.ExtensionContext,
  authService: AuthService | null,
  configService: ConfigService,
): Promise<vscode.Disposable[]> {
  const disposables: vscode.Disposable[] = [];

  // ── Services ──────────────────────────────────────────────────────────────
  const getToken = authService
    ? () => authService.getAccessToken()
    : () => Promise.resolve<string | null>(null);

  // ── Self-update at init: auto-installs a newer VSIX from the configured repo ──
  // (throttled once/day internally; needs the token to read a PRIVATE update repo)
  const currentVersion =
    (context.extension?.packageJSON as { version?: string } | undefined)?.version ?? '0.0.0';
  await enforceLatestVersion(context, currentVersion, configService, { getToken });

  const marketplaceService = new MarketplaceService(configService, getToken);
  disposables.push(marketplaceService);

  await marketplaceService.initialize();

  const assetLoader = new AssetLoader(context, configService, marketplaceService);
  const scopeService = new ScopeService(context);
  const copilotExporter = new CopilotExporter(assetLoader);
  const mcpInstaller = new McpInstaller();
  const pluginRegistry = new PluginRegistry(context);
  const assetInstaller = new AssetInstaller(context, assetLoader, configService, marketplaceService);

  await assetLoader.loadAll();

  // Reload assets whenever the marketplace catalog refreshes.
  disposables.push(
    marketplaceService.onDidChangeCatalog(() => void assetLoader.loadAll()),
  );

  // ── TreeView: Inspector (asset-hierarchy navigator) ───────────────────────
  const inspectorProvider = new InspectorProvider(
    assetLoader,
    scopeService,
    pluginRegistry,
    mcpInstaller,
    marketplaceService,
  );
  const inspectorTreeView = vscode.window.createTreeView(VIEW_IDS.INSPECTOR, {
    treeDataProvider: inspectorProvider,
    showCollapseAll: true,
  });
  disposables.push(inspectorTreeView);

  // ── Chat Participant ──────────────────────────────────────────────────────
  disposables.push(
    registerParticipant(context, assetLoader, scopeService, configService, authService),
  );

  // ── Inspector Commands ────────────────────────────────────────────────────
  disposables.push(
    ...registerInspectorCommands(
      context,
      assetLoader,
      inspectorProvider,
      configService,
      scopeService,
      copilotExporter,
      marketplaceService,
    ),
  );

  // ── Commands ──────────────────────────────────────────────────────────────
  disposables.push(
    vscode.commands.registerCommand(
      COMMANDS.OPEN_MARKETPLACE,
      (preFilter?: MarketplacePreFilter) => {
        MarketplacePanel.createOrShow(
          context,
          assetLoader,
          configService,
          scopeService,
          pluginRegistry,
          marketplaceService,
          preFilter,
        );
      },
    ),
    vscode.commands.registerCommand(COMMANDS.EXPORT_TO_COPILOT, async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Agent Studio: Exporting to Copilot…',
          cancellable: false,
        },
        async () => {
          const repoIds = scopeService.getRepoScopedIds();
          const result = await copilotExporter.exportAll(
            repoIds.length > 0 ? repoIds : undefined,
          );
          if (!result.ok) {
            vscode.window.showErrorMessage(`Export failed: ${result.error}`);
            return;
          }
          const count = result.written?.length ?? 0;
          const action = await vscode.window.showInformationMessage(
            `✅ Exported ${count} files to .github/  — Copilot will now use your repo-scoped skills, agents, and instructions natively.`,
            'Show Files',
          );
          if (action === 'Show Files') {
            const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (wsRoot) {
              vscode.commands.executeCommand(
                'revealInExplorer',
                vscode.Uri.joinPath(wsRoot, '.github'),
              );
            }
          }
        },
      );
    }),
  );

  // ── Plugin commands ───────────────────────────────────────────────────────
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.INSTALL_PLUGIN, async (_node?: InstalledPluginNode) => {
      vscode.commands.executeCommand(COMMANDS.OPEN_MARKETPLACE);
      vscode.window.showInformationMessage('Browse plugins in the Marketplace → Plugins tab.');
    }),
    vscode.commands.registerCommand(COMMANDS.UNINSTALL_PLUGIN, async (node?: InstalledPluginNode) => {
      const pluginName = node?.record.name ?? (await _pickInstalledPlugin(pluginRegistry));
      if (!pluginName) return;
      await pluginRegistry.uninstall(pluginName);
      vscode.window.showInformationMessage(
        `🗑 "${pluginName}" uninstalled. The terminal ran \`copilot plugin uninstall ${pluginName}\`.`,
      );
    }),
  );

  // Dispose scope service when surface tears down
  disposables.push(scopeService);

  return disposables;
}

async function _pickInstalledPlugin(registry: PluginRegistry): Promise<string | undefined> {
  const installed = registry.getInstalled();
  if (installed.length === 0) {
    vscode.window.showInformationMessage('No plugins installed yet.');
    return undefined;
  }
  const items = installed.map((p) => ({
    label: p.name,
    description: `v${p.version}`,
    detail: p.description,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a plugin to uninstall',
    matchOnDetail: true,
  });
  return picked?.label;
}
