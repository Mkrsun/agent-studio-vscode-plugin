import * as vscode from 'vscode';
import { AssetLoader } from '../services/assetLoader';
import { AssetRegistry } from './assetRegistry';
import { AssetInstaller } from './installer';
import { isNewer } from '../utils/version';
import { McpInstaller, MCP_CATALOG, COPILOT_EXTENSIONS_CATALOG } from './mcpInstaller';
import { PluginRegistry } from './pluginRegistry';
import { MarketplaceSource } from './pluginTypes';
import { ConfigService } from '../services/configService';
import { ScopeService } from '../services/scopeService';
import { CopilotExporter } from '../services/copilotExporter';
import { MarketplaceService } from './marketplaceService';
import { AssetType } from '../models/types';
import { getNonce } from '../utils/webviewUtils';

export type MarketplaceTab = 'assets' | 'plugins' | 'mcp' | 'extensions';
export interface MarketplacePreFilter {
  tab?: MarketplaceTab;
  assetType?: AssetType;
}

type IncomingMsg =
  | { type: 'marketplace:ready' }
  | { type: 'marketplace:filterChange'; query: string; assetType: string }
  | { type: 'marketplace:install'; assetId: string }
  | { type: 'marketplace:update'; assetId: string }
  | { type: 'marketplace:uninstall'; assetId: string }
  | { type: 'marketplace:preview'; assetId: string }
  | { type: 'marketplace:installMcp'; serverId: string }
  | { type: 'marketplace:uninstallMcp'; serverId: string }
  | { type: 'marketplace:installPlugin'; pluginName: string; marketplaceId: string }
  | { type: 'marketplace:uninstallPlugin'; pluginName: string }
  | { type: 'marketplace:addMarketplace' }
  | { type: 'marketplace:refreshPlugins' };

export class MarketplacePanel {
  static currentPanel: MarketplacePanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _registry: AssetRegistry;
  private readonly _installer: AssetInstaller;
  private readonly _mcpInstaller: McpInstaller;
  private readonly _exporter: CopilotExporter;

  static createOrShow(
    context: vscode.ExtensionContext,
    assetLoader: AssetLoader,
    configService: ConfigService,
    scopeService: ScopeService,
    pluginRegistry: PluginRegistry,
    marketplaceService: MarketplaceService,
    preFilter?: MarketplacePreFilter,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Two;
    if (MarketplacePanel.currentPanel) {
      MarketplacePanel.currentPanel._panel.reveal(column);
      if (preFilter) MarketplacePanel.currentPanel._applyFilter(preFilter);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'agentStudioMarketplace',
      'Agent Studio Marketplace',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
        ],
      },
    );
    MarketplacePanel.currentPanel = new MarketplacePanel(
      panel, context, assetLoader, configService, scopeService, pluginRegistry, marketplaceService, preFilter,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private context: vscode.ExtensionContext,
    private assetLoader: AssetLoader,
    private configService: ConfigService,
    private scopeService: ScopeService,
    private pluginRegistry: PluginRegistry,
    private marketplaceService: MarketplaceService,
    private _preFilter?: MarketplacePreFilter,
  ) {
    this._panel = panel;
    this._registry = new AssetRegistry(assetLoader);
    this._installer = new AssetInstaller(context, assetLoader, configService, marketplaceService);
    this._mcpInstaller = new McpInstaller();
    this._exporter = new CopilotExporter(assetLoader);

    this._panel.webview.html = this._getHtml();
    this._panel.webview.onDidReceiveMessage((msg: IncomingMsg) => this._handle(msg));
    this._panel.onDidDispose(() => { MarketplacePanel.currentPanel = undefined; });
  }

  /** Build the asset-state message the webview uses to pick Install / Installed / Update. */
  private _assetStateMsg(assetId: string): Record<string, unknown> {
    const installed = this.scopeService.getScope(assetId) === 'repo';
    const installedVersion = this.scopeService.getInstalledVersion(assetId);
    const availableVersion = this.assetLoader.getById(assetId)?.version;
    const hasUpdate =
      installed && !!installedVersion && !!availableVersion && isNewer(availableVersion, installedVersion);
    return { type: 'marketplace:assetState', assetId, installed, installedVersion, availableVersion, hasUpdate };
  }

  private async _handle(msg: IncomingMsg): Promise<void> {
    switch (msg.type) {
      case 'marketplace:ready': {
        // ── AI Assets ──────────────────────────────────────────────────────
        const initialType = this._preFilter?.assetType ?? 'all';
        const assets = this._registry.getCatalog('', initialType);
        this._post({ type: 'marketplace:loadCatalog', assets } as any);

        // Send state for the FULL catalog (not just the visible filter) so Install/
        // Update status is correct on every tab.
        for (const entry of this._registry.getCatalog('', 'all')) {
          this._post(this._assetStateMsg(entry.id) as any);
        }

        // ── MCP Servers ────────────────────────────────────────────────────
        this._post({ type: 'marketplace:loadMcp' as any, servers: MCP_CATALOG } as any);
        for (const server of MCP_CATALOG) {
          const installed = await this._mcpInstaller.isInstalled(server.id);
          this._post({ type: 'marketplace:mcpState' as any, serverId: server.id, installed } as any);
        }

        // ── Copilot Extensions ─────────────────────────────────────────────
        this._post({ type: 'marketplace:loadExtensions' as any, extensions: COPILOT_EXTENSIONS_CATALOG } as any);

        // ── Plugin marketplaces (fetch async, send when ready) ────────────
        this._sendPluginCatalog();

        // ── Apply initial tab/type filter, if any ──────────────────────────
        if (this._preFilter) this._applyFilter(this._preFilter);
        break;
      }

      case 'marketplace:filterChange': {
        const assets = this._registry.getCatalog(
          msg.query,
          msg.assetType as AssetType | 'all',
        );
        this._post({ type: 'marketplace:loadCatalog', assets } as any);
        break;
      }

      case 'marketplace:install':
      case 'marketplace:update': {
        const updating = msg.type === 'marketplace:update';
        await this.scopeService.setScope(msg.assetId, 'repo');
        const result = await this._exporter.exportOne(
          msg.assetId,
          this.scopeService.getRepoScopedIds(),
        );
        const asset = this.assetLoader.getById(msg.assetId);
        if (result.ok) {
          if (asset) await this.scopeService.setInstalledVersion(msg.assetId, asset.version);
          vscode.window.showInformationMessage(
            updating
              ? `⬆ "${asset?.name}" updated to v${asset?.version} in .github/.`
              : `✅ "${asset?.name}" installed to .github/ — Copilot will pick it up natively.`,
          );
        } else {
          vscode.window.showErrorMessage(`${updating ? 'Update' : 'Install'} failed: ${result.error}`);
          if (!updating) await this.scopeService.setScope(msg.assetId, 'disabled');
        }
        this._post(this._assetStateMsg(msg.assetId) as any);
        break;
      }

      case 'marketplace:uninstall': {
        await this.scopeService.setScope(msg.assetId, 'disabled');
        await this.scopeService.clearInstalledVersion(msg.assetId);
        const result = await this._exporter.removeOne(
          msg.assetId,
          this.scopeService.getRepoScopedIds(),
        );
        const asset = this.assetLoader.getById(msg.assetId);
        if (result.ok) {
          vscode.window.showInformationMessage(`🗑 "${asset?.name}" uninstalled from .github/`);
        } else {
          vscode.window.showErrorMessage(`Uninstall failed: ${result.error}`);
        }
        this._post(this._assetStateMsg(msg.assetId) as any);
        break;
      }

      case 'marketplace:preview': {
        const asset = this.assetLoader.getById(msg.assetId);
        if (!asset) return;
        vscode.workspace.openTextDocument({
          language: 'yaml',
          content: `# ${asset.name}\n# Type: ${asset.type}\n# Description: ${asset.description}\n`,
        }).then(d => vscode.window.showTextDocument(d, { preview: true }));
        break;
      }

      case 'marketplace:installMcp': {
        const server = MCP_CATALOG.find(s => s.id === msg.serverId);
        if (!server) return;
        try {
          await this._mcpInstaller.install(server);
          this._post({ type: 'marketplace:mcpState' as any, serverId: server.id, installed: true } as any);
          const envVars = server.env ? Object.keys(server.env) : [];
          if (envVars.length > 0) {
            vscode.window.showWarningMessage(
              `MCP server "${server.name}" installed. Set env vars: ${envVars.join(', ')}`,
              'Open mcp.json',
            ).then(action => {
              if (action === 'Open mcp.json') {
                const root = vscode.workspace.workspaceFolders?.[0]?.uri;
                if (root) vscode.window.showTextDocument(vscode.Uri.joinPath(root, '.vscode', 'mcp.json'));
              }
            });
          } else {
            vscode.window.showInformationMessage(`✅ "${server.name}" MCP server installed in .vscode/mcp.json`);
          }
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to install MCP server: ${e}`);
          this._post({ type: 'marketplace:mcpState' as any, serverId: server.id, installed: false } as any);
        }
        break;
      }

      case 'marketplace:uninstallMcp': {
        await this._mcpInstaller.uninstall(msg.serverId);
        this._post({ type: 'marketplace:mcpState' as any, serverId: msg.serverId, installed: false } as any);
        break;
      }

      // ── Plugin marketplace messages ──────────────────────────────────────

      case 'marketplace:installPlugin': {
        // Find the entry + its marketplace source
        const sources = this.pluginRegistry.getMarketplaceSources();
        const entries = await this.pluginRegistry.fetchAll();
        const match = entries.find(e => e.name === msg.pluginName && e._marketplace.id === msg.marketplaceId);
        if (!match) {
          vscode.window.showErrorMessage(`Plugin "${msg.pluginName}" not found in marketplace.`);
          return;
        }
        await this.pluginRegistry.install(match, match._marketplace);
        this._post({ type: 'marketplace:pluginState' as any, pluginName: msg.pluginName, installed: true } as any);
        vscode.window.showInformationMessage(
          `🔌 "${msg.pluginName}" is being installed via Copilot CLI in the terminal.`,
        );
        break;
      }

      case 'marketplace:uninstallPlugin': {
        await this.pluginRegistry.uninstall(msg.pluginName);
        this._post({ type: 'marketplace:pluginState' as any, pluginName: msg.pluginName, installed: false } as any);
        vscode.window.showInformationMessage(`🗑 "${msg.pluginName}" removed.`);
        break;
      }

      case 'marketplace:addMarketplace': {
        await this._promptAddMarketplace();
        break;
      }

      case 'marketplace:refreshPlugins': {
        this._sendPluginCatalog();
        break;
      }
    }
  }

  // ── Plugin catalog helpers ───────────────────────────────────────────────

  private async _sendPluginCatalog(): Promise<void> {
    // Tell webview we're loading
    this._post({ type: 'marketplace:pluginsLoading' as any } as any);

    const entries = await this.pluginRegistry.fetchAll();
    const installed = this.pluginRegistry.getInstalled();
    const installedNames = new Set(installed.map(p => p.name));

    // Group by marketplace
    const byMarketplace: Record<string, { marketplace: any; plugins: any[] }> = {};
    for (const entry of entries) {
      const id = entry._marketplace.id;
      if (!byMarketplace[id]) {
        byMarketplace[id] = { marketplace: entry._marketplace, plugins: [] };
      }
      byMarketplace[id].plugins.push({
        ...entry,
        installed: installedNames.has(entry.name),
        _marketplace: undefined,
      });
    }

    // Also include custom marketplaces that might be empty (network error)
    const sources = this.pluginRegistry.getMarketplaceSources();
    for (const src of sources) {
      if (!byMarketplace[src.id]) {
        byMarketplace[src.id] = { marketplace: src, plugins: [] };
      }
    }

    this._post({ type: 'marketplace:loadPlugins' as any, groups: Object.values(byMarketplace) } as any);

    // Send installed state for each plugin
    for (const record of installed) {
      this._post({ type: 'marketplace:pluginState' as any, pluginName: record.name, installed: true } as any);
    }
  }

  private async _promptAddMarketplace(): Promise<void> {
    const input = await vscode.window.showInputBox({
      title: 'Add Plugin Marketplace',
      prompt: 'Enter the GitHub repo in owner/repo format (e.g. my-org/marketplace-chile)',
      placeHolder: 'owner/repo',
      validateInput: (v) => {
        if (!v.includes('/')) return 'Must be in owner/repo format';
        return undefined;
      },
    });
    if (!input) return;

    const [owner, repo] = input.trim().split('/');
    const label = await vscode.window.showInputBox({
      title: 'Marketplace Label',
      prompt: 'Give this marketplace a display name',
      placeHolder: `e.g. ${repo}`,
      value: repo,
    });
    if (!label) return;

    const src: MarketplaceSource = {
      id: `${owner}-${repo}`,
      label: label ?? repo,
      owner,
      repo,
    };

    await this.pluginRegistry.addMarketplace(src);
    vscode.window.showInformationMessage(`✅ Marketplace "${label}" added. Refreshing plugins…`);
    this._sendPluginCatalog();
  }

  // ── Messaging ────────────────────────────────────────────────────────────

  private _post(msg: object): void {
    this._panel.webview.postMessage(msg);
  }

  /** Tell the webview to switch to a tab and/or set the asset-type filter. */
  private _applyFilter(filter: MarketplacePreFilter): void {
    this._post({
      type: 'marketplace:applyFilter',
      tab: filter.tab,
      assetType: filter.assetType,
    });
    // Re-send the catalog pre-filtered so the Assets grid matches the dropdown.
    if (filter.assetType) {
      const assets = this._registry.getCatalog('', filter.assetType);
      this._post({ type: 'marketplace:loadCatalog', assets });
    }
  }

  // ── HTML ─────────────────────────────────────────────────────────────────

  private _getHtml(): string {
    const wv = this._panel.webview;
    const css = wv.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'marketplace', 'marketplace.css'));
    const js  = wv.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'marketplace-webview.js'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${wv.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}' ${wv.cspSource};
             img-src ${wv.cspSource} https: data:;">
  <link rel="stylesheet" href="${css}">
  <title>Agent Studio Marketplace</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
