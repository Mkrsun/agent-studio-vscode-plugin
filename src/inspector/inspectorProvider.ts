import * as vscode from 'vscode';
import { AssetLoader } from '../services/assetLoader';
import { ScopeService } from '../services/scopeService';
import { PluginRegistry } from '../marketplace/pluginRegistry';
import { McpInstaller } from '../marketplace/mcpInstaller';
import { MarketplaceService } from '../marketplace/marketplaceService';
import { AssetType } from '../models/types';
import { ASSET_TYPES } from '../constants';
import {
  InspectorNode,
  MarketplaceGroupNode,
  CategoryNode,
  AssetNode,
  PluginCategoryNode,
  InstalledPluginNode,
  NoPluginsNode,
  McpCategoryNode,
  InstalledMcpNode,
  NoMcpNode,
} from './inspectorTreeItem';

export class InspectorProvider implements vscode.TreeDataProvider<InspectorNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<InspectorNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly assetLoader: AssetLoader,
    private readonly scopeService: ScopeService,
    private readonly pluginRegistry: PluginRegistry,
    private readonly mcpInstaller: McpInstaller,
    private readonly marketplaceService: MarketplaceService,
  ) {
    scopeService.onDidChangeScope(() => this._onDidChangeTreeData.fire());
    pluginRegistry.onDidChange(() => this._onDidChangeTreeData.fire());
    mcpInstaller.onDidChange(() => this._onDidChangeTreeData.fire());
    marketplaceService.onDidChangeCatalog(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: InspectorNode): vscode.TreeItem {
    return element.toTreeItem();
  }

  getChildren(element?: InspectorNode): InspectorNode[] {
    // ── Root: only the top-level marketplace groups (those without a parent).
    //          The Plugins and MCP Servers sections now live INSIDE each
    //          top-level group, not as siblings at the root.
    if (!element) {
      const all = this.marketplaceService.getMarketplaces();
      const topLevel = all.filter((m) => !m.descriptor.parent);
      // Top-level groups always expand: they always hold the Plugins + MCP sections.
      return topLevel.map((m) => new MarketplaceGroupNode(m, true));
    }

    // ── Marketplace group → nested child marketplaces (if any), this group's own
    //    asset-type categories, and — for top-level groups — the Plugins and MCP
    //    Servers sections nested inside.
    if (element instanceof MarketplaceGroupNode) {
      const { marketplace } = element;
      const isTopLevel = !marketplace.descriptor.parent;

      const childGroups = this.marketplaceService
        .getMarketplaces()
        .filter((m) => m.descriptor.parent === marketplace.descriptor.id)
        .map((m) => new MarketplaceGroupNode(m, this._hasChildren(m.descriptor.id)));

      const ownCategories =
        marketplace.status === 'ready' && marketplace.assets.length > 0
          ? ASSET_TYPES.map((type) => new CategoryNode(type as AssetType, marketplace.descriptor.id))
          : [];

      const globalSections = isTopLevel
        ? [new PluginCategoryNode(), new McpCategoryNode()]
        : [];

      return [...childGroups, ...ownCategories, ...globalSections];
    }

    // ── Category node → individual assets (filtered by marketplaceId when set).
    if (element instanceof CategoryNode) {
      const assets = element.marketplaceId
        ? this.assetLoader
            .getAssetsByMarketplace(element.marketplaceId)
            .filter((a) => a.type === element.assetType)
        : this.assetLoader.getAssetsByType(element.assetType);

      if (assets.length === 0) {
        const empty = new vscode.TreeItem('No assets of this type');
        empty.description = 'Browse the Marketplace to find more';
        return [{ toTreeItem: () => empty } as InspectorNode];
      }

      const sorted = [...assets].sort((a, b) => {
        const aInstalled = this.scopeService.getScope(a.id) === 'repo' ? 0 : 1;
        const bInstalled = this.scopeService.getScope(b.id) === 'repo' ? 0 : 1;
        return aInstalled - bInstalled;
      });
      return sorted.map((a) => new AssetNode(a, this.scopeService.getScope(a.id)));
    }

    // ── Plugins section.
    if (element instanceof PluginCategoryNode) {
      const installed = this.pluginRegistry.getInstalled();
      if (installed.length === 0) return [new NoPluginsNode()];
      return installed.map((record) => new InstalledPluginNode(record));
    }

    // ── MCP servers section.
    if (element instanceof McpCategoryNode) {
      const installed = this.mcpInstaller.getInstalled();
      if (installed.length === 0) return [new NoMcpNode()];
      return installed.map((server) => new InstalledMcpNode(server));
    }

    return [];
  }

  getParent(): undefined {
    return undefined;
  }

  /** True if any configured marketplace declares `parent === id`. */
  private _hasChildren(id: string): boolean {
    return this.marketplaceService.getMarketplaces().some((m) => m.descriptor.parent === id);
  }
}
