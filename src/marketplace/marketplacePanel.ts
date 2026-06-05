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
import { HostMessage, WebviewMessage } from '../shared/protocol';
import { log, error as logError } from '../services/logger';
import { recordAsset } from '../analytics/metrics';

export type MarketplaceTab = 'assets' | 'plugins' | 'mcp' | 'extensions';
export interface MarketplacePreFilter {
  tab?: MarketplaceTab;
  assetType?: AssetType;
}

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

    log('Opening marketplace panel', 'marketplace');
    this._panel.webview.html = this._getHtml();
    this._panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this._handle(msg));
    this._panel.onDidDispose(() => { MarketplacePanel.currentPanel = undefined; });
  }

  /** Build the asset-state message the webview uses to pick Install / Installed / Update. */
  private _assetStateMsg(assetId: string): HostMessage {
    const installed = this.scopeService.getScope(assetId) === 'repo';
    const installedVersion = this.scopeService.getInstalledVersion(assetId);
    const availableVersion = this.assetLoader.getById(assetId)?.version;
    const hasUpdate =
      installed && !!installedVersion && !!availableVersion && isNewer(availableVersion, installedVersion);
    const autoUpdate = this.scopeService.getAutoUpdate(assetId);
    return { type: 'marketplace:assetState', assetId, installed, installedVersion, availableVersion, hasUpdate, autoUpdate };
  }

  private async _handle(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'webview:error': {
        // A global error from the webview (often a load-time failure that left the
        // panel blank). Surface it in the output channel for diagnosis.
        logError('Marketplace webview error', msg.error, 'webview');
        return;
      }

      case 'marketplace:ready': {
        log('Webview ready — streaming catalogs', 'marketplace');
        // ── AI Assets ──────────────────────────────────────────────────────
        const initialType = this._preFilter?.assetType ?? 'all';
        const assets = this._registry.getCatalog('', initialType);
        this._post({ type: 'marketplace:loadCatalog', assets });

        // Send state for the FULL catalog (not just the visible filter) so Install/
        // Update status is correct on every tab.
        for (const entry of this._registry.getCatalog('', 'all')) {
          this._post(this._assetStateMsg(entry.id));
        }

        // ── MCP Servers ────────────────────────────────────────────────────
        this._post({ type: 'marketplace:loadMcp', servers: MCP_CATALOG });
        for (const server of MCP_CATALOG) {
          const installed = await this._mcpInstaller.isInstalled(server.id);
          this._post({ type: 'marketplace:mcpState', serverId: server.id, installed });
        }

        // ── Copilot Extensions ─────────────────────────────────────────────
        this._post({ type: 'marketplace:loadExtensions', extensions: COPILOT_EXTENSIONS_CATALOG });

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
        this._post({ type: 'marketplace:loadCatalog', assets });
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
          if (asset) {
            recordAsset({ event: updating ? 'update' : 'install', assetId: asset.id, assetType: asset.type, marketplace: asset.marketplaceId });
          }
          vscode.window.showInformationMessage(
            updating
              ? `⬆ "${asset?.name}" updated to v${asset?.version} in .github/.`
              : `✅ "${asset?.name}" installed to .github/ — Copilot will pick it up natively.`,
          );
        } else {
          vscode.window.showErrorMessage(`${updating ? 'Update' : 'Install'} failed: ${result.error}`);
          if (!updating) await this.scopeService.setScope(msg.assetId, 'disabled');
        }
        this._post(this._assetStateMsg(msg.assetId));
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
          if (asset) {
            recordAsset({ event: 'uninstall', assetId: asset.id, assetType: asset.type, marketplace: asset.marketplaceId });
          }
          vscode.window.showInformationMessage(`🗑 "${asset?.name}" uninstalled from .github/`);
        } else {
          vscode.window.showErrorMessage(`Uninstall failed: ${result.error}`);
        }
        this._post(this._assetStateMsg(msg.assetId));
        break;
      }

      case 'marketplace:setAutoUpdate': {
        await this.scopeService.setAutoUpdate(msg.assetId, msg.enabled);
        this._post(this._assetStateMsg(msg.assetId));
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
          this._post({ type: 'marketplace:mcpState', serverId: server.id, installed: true });
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
          this._post({ type: 'marketplace:mcpState', serverId: server.id, installed: false });
        }
        break;
      }

      case 'marketplace:uninstallMcp': {
        await this._mcpInstaller.uninstall(msg.serverId);
        this._post({ type: 'marketplace:mcpState', serverId: msg.serverId, installed: false });
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
        this._post({ type: 'marketplace:pluginState', pluginName: msg.pluginName, installed: true });
        vscode.window.showInformationMessage(
          `🔌 "${msg.pluginName}" is being installed via Copilot CLI in the terminal.`,
        );
        break;
      }

      case 'marketplace:uninstallPlugin': {
        await this.pluginRegistry.uninstall(msg.pluginName);
        this._post({ type: 'marketplace:pluginState', pluginName: msg.pluginName, installed: false });
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
    this._post({ type: 'marketplace:pluginsLoading' });

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

    this._post({ type: 'marketplace:loadPlugins', groups: Object.values(byMarketplace) });

    // Send installed state for each plugin
    for (const record of installed) {
      this._post({ type: 'marketplace:pluginState', pluginName: record.name, installed: true });
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

  private _post(msg: HostMessage): void {
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
  <script nonce="${nonce}">
    // Acquire the VS Code API ONCE here and share it with the bundle (which reads
    // window.__vscodeApi instead of acquiring again). This lets these global error
    // handlers — installed BEFORE the bundle loads — both render a visible error
    // into #root and relay it to the extension's output channel, even if the
    // bundle throws at load time (which would otherwise leave a blank panel).
    var __vscode = acquireVsCodeApi();
    window.__vscodeApi = __vscode;
    function __report(kind, msg) {
      try { __vscode.postMessage({ type: 'webview:error', error: kind + ': ' + msg }); } catch (e) {}
      var r = document.getElementById('root');
      if (r && !r.dataset.mounted) {
        r.innerHTML = '<pre style="color:var(--vscode-errorForeground);white-space:pre-wrap;' +
          'padding:16px;font-family:var(--vscode-editor-font-family,monospace);font-size:12px">' +
          'Agent Studio — the marketplace UI failed to load.\n\n' + kind + ': ' +
          String(msg).replace(/</g, '&lt;') +
          '\n\nSee Output → "Agent Studio" for details, or reload the window.</pre>';
      }
    }
    window.addEventListener('error', function (e) { __report('error', (e.error && e.error.stack) || e.message); });
    window.addEventListener('unhandledrejection', function (e) { __report('unhandledrejection', (e.reason && e.reason.stack) || e.reason); });
  </script>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
