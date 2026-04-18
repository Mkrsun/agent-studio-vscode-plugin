import * as vscode from 'vscode';
import { AssetLoader } from '../services/assetLoader';
import { ScopeService } from '../services/scopeService';
import { PluginRegistry } from '../marketplace/pluginRegistry';
import { McpInstaller } from '../marketplace/mcpInstaller';
import { MarketplaceService } from '../marketplace/marketplaceService';
import { AssetType } from '../models/types';
import { ASSET_TYPES } from '../constants';
import {
  LibraryNode,
  MarketplaceGroupNode,
  CategoryNode,
  AssetNode,
  PluginCategoryNode,
  InstalledPluginNode,
  NoPluginsNode,
  McpCategoryNode,
  InstalledMcpNode,
  NoMcpNode,
} from './libraryTreeItem';

export class LibraryProvider implements vscode.TreeDataProvider<LibraryNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<LibraryNode | undefined | void>();
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

  getTreeItem(element: LibraryNode): vscode.TreeItem {
    return element.toTreeItem();
  }

  getChildren(element?: LibraryNode): LibraryNode[] {
    // ── Root: one MarketplaceGroupNode per configured marketplace,
    //          then Plugins and MCP Servers sections.
    if (!element) {
      const marketplaceNodes = this.marketplaceService
        .getMarketplaces()
        .map((m) => new MarketplaceGroupNode(m));

      return [...marketplaceNodes, new PluginCategoryNode(), new McpCategoryNode()];
    }

    // ── Marketplace group → asset-type categories scoped to that marketplace.
    if (element instanceof MarketplaceGroupNode) {
      const { marketplace } = element;
      if (marketplace.status !== 'ready' || marketplace.assets.length === 0) return [];

      return ASSET_TYPES.map(
        (type) => new CategoryNode(type as AssetType, marketplace.descriptor.id),
      );
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
        return [{ toTreeItem: () => empty } as LibraryNode];
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
}
