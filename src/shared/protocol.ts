// Single source of truth for the marketplace webview message protocol + DTOs.
// Imported by BOTH the extension (marketplacePanel) and the React webview, so the
// Host⇄Webview contract is type-checked end to end (no more `as any`).

// ── Data DTOs ────────────────────────────────────────────────────────────────
export interface CatalogAsset {
  id: string;
  type: string;
  name: string;
  version: string;
  description: string;
  tags?: string[];
  source?: string;
}

export interface AssetState {
  installed: boolean;
  hasUpdate: boolean;
  installedVersion?: string;
  availableVersion?: string;
  /** Per-asset auto-update preference (off by default). Only meaningful when installed. */
  autoUpdate: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  env?: Record<string, unknown>;
  requiresNpx?: boolean;
  requiresUvx?: boolean;
  installDocs?: string;
}

export interface CopilotExtension {
  name: string;
  publisher: string;
  description: string;
  category: string;
  tags?: string[];
  marketplaceUrl: string;
}

export interface PluginMarketplaceRef {
  id: string;
  label: string;
  owner: string;
  repo: string;
}

export interface PluginEntry {
  name: string;
  version: string;
  description: string;
  type?: string;
  author?: string;
  components?: string[];
  phases?: string[];
  agentCount?: { orchestrators: number; specialists: number };
  generates?: string[];
  wayOfWorking?: string;
  domains?: string[];
  keywords?: string[];
  homepage?: string;
  installed?: boolean;
}

export interface PluginGroup {
  marketplace: PluginMarketplaceRef;
  plugins: PluginEntry[];
}

export type MarketplaceTabId = 'assets' | 'plugins' | 'mcp' | 'extensions';

// ── Host → Webview ───────────────────────────────────────────────────────────
export type HostMessage =
  | { type: 'marketplace:loadCatalog'; assets: CatalogAsset[] }
  | { type: 'marketplace:assetState'; assetId: string; installed: boolean; hasUpdate: boolean; autoUpdate: boolean; installedVersion?: string; availableVersion?: string }
  | { type: 'marketplace:installResult'; assetId: string; success: boolean; error?: string }
  | { type: 'marketplace:loadMcp'; servers: McpServer[] }
  | { type: 'marketplace:mcpState'; serverId: string; installed: boolean }
  | { type: 'marketplace:loadExtensions'; extensions: CopilotExtension[] }
  | { type: 'marketplace:pluginsLoading' }
  | { type: 'marketplace:loadPlugins'; groups: PluginGroup[] }
  | { type: 'marketplace:pluginState'; pluginName: string; installed: boolean }
  | { type: 'marketplace:applyFilter'; tab?: MarketplaceTabId; assetType?: string };

// ── Webview → Host ───────────────────────────────────────────────────────────
export type WebviewMessage =
  | { type: 'marketplace:ready' }
  | { type: 'marketplace:filterChange'; query: string; assetType: string }
  | { type: 'marketplace:install'; assetId: string }
  | { type: 'marketplace:update'; assetId: string }
  | { type: 'marketplace:uninstall'; assetId: string }
  | { type: 'marketplace:setAutoUpdate'; assetId: string; enabled: boolean }
  | { type: 'marketplace:preview'; assetId: string }
  | { type: 'marketplace:installMcp'; serverId: string }
  | { type: 'marketplace:uninstallMcp'; serverId: string }
  | { type: 'marketplace:installPlugin'; pluginName: string; marketplaceId: string }
  | { type: 'marketplace:uninstallPlugin'; pluginName: string }
  | { type: 'marketplace:addMarketplace' }
  | { type: 'marketplace:refreshPlugins' }
  /** Relayed from the webview's global error handlers → logged to the output channel. */
  | { type: 'webview:error'; error: string };
