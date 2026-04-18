import * as vscode from 'vscode';
import { Asset, AssetType, Workflow, Instruction } from '../models/types';
import { parseAssetManifest } from '../models/validators';
import { ConfigService } from './configService';
import { WorkspaceService } from './workspaceService';
import { MarketplaceService } from '../marketplace/marketplaceService';

export class AssetLoader {
  private _cache = new Map<string, Asset>();
  private _workspaceService: WorkspaceService;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _config: ConfigService,
    private readonly _marketplaceService: MarketplaceService,
  ) {
    this._workspaceService = new WorkspaceService(_config);
  }

  async loadAll(): Promise<Asset[]> {
    this._cache.clear();

    const [marketplace, workspace] = await Promise.all([
      this._loadMarketplaceAssets(),
      this._loadWorkspaceAssets(),
    ]);

    // Workspace assets shadow marketplace assets with the same id+marketplaceId.
    const all = [...marketplace, ...workspace];

    for (const asset of all) {
      const yamlDefault = asset.enabled === 'enabled';
      const isEnabled = this._config.isAssetEnabled(asset.id, yamlDefault);
      asset.enabled = isEnabled ? 'enabled' : 'disabled';
      // Key includes marketplaceId so same-id assets from different marketplaces coexist.
      this._cache.set(this._key(asset), asset);
    }

    return all;
  }

  private async _loadMarketplaceAssets(): Promise<Asset[]> {
    const refs = this._marketplaceService.getAllAssetRefs();
    const assets: Asset[] = [];

    await Promise.all(
      refs.map(async (ref) => {
        try {
          const raw = await this._marketplaceService.fetchAssetContent(
            ref.marketplaceId,
            ref,
          );
          const asset = parseAssetManifest(raw, ref.path, 'remote');
          asset.marketplaceId = ref.marketplaceId;
          assets.push(asset);
        } catch (e) {
          console.warn(`[Agent Studio] Failed to load asset ${ref.id} from ${ref.marketplaceId}: ${e}`);
        }
      }),
    );

    return assets;
  }

  private async _loadWorkspaceAssets(): Promise<Asset[]> {
    const folderUri = this._workspaceService.getAssetsFolderUri();
    if (!folderUri) return [];
    return this._loadFromDirectory(folderUri, 'workspace');
  }

  private async _loadFromDirectory(
    dirUri: vscode.Uri,
    source: 'workspace',
  ): Promise<Asset[]> {
    const uris = await this._workspaceService.listYamlFiles(dirUri);
    const assets: Asset[] = [];
    for (const uri of uris) {
      try {
        const raw = await this._workspaceService.readFile(uri);
        const asset = parseAssetManifest(raw, uri.fsPath, source);
        assets.push(asset);
      } catch (e) {
        console.error(`[Agent Studio] Failed to load workspace asset from ${uri.fsPath}: ${e}`);
      }
    }
    return assets;
  }

  private _key(asset: Asset): string {
    return asset.marketplaceId ? `${asset.marketplaceId}:${asset.id}` : asset.id;
  }

  getAll(): Asset[] {
    return Array.from(this._cache.values());
  }

  getAssetsByType(type: AssetType): Asset[] {
    return Array.from(this._cache.values()).filter((a) => a.type === type);
  }

  getAssetsByMarketplace(marketplaceId: string): Asset[] {
    return Array.from(this._cache.values()).filter(
      (a) => a.marketplaceId === marketplaceId,
    );
  }

  getById(id: string, marketplaceId?: string): Asset | undefined {
    if (marketplaceId) return this._cache.get(`${marketplaceId}:${id}`);
    // Fallback: search by id only (for workspace assets without marketplaceId).
    return (
      this._cache.get(id) ??
      Array.from(this._cache.values()).find((a) => a.id === id)
    );
  }

  getEnabledWorkflows(): Workflow[] {
    return this.getAssetsByType('workflow').filter((a) => a.enabled === 'enabled') as Workflow[];
  }

  getEnabledInstructions(): Instruction[] {
    return this.getAssetsByType('instruction').filter(
      (a) => a.enabled === 'enabled',
    ) as Instruction[];
  }

  getEnabledSkills() {
    return this.getAssetsByType('skill').filter((a) => a.enabled === 'enabled');
  }

  getCatalogEntries() {
    return Array.from(this._cache.values()).map((a) => ({
      id: a.id,
      type: a.type,
      name: a.name,
      version: a.version,
      description: a.description,
      tags: a.tags ?? [],
      source: a.source,
      enabled: a.enabled,
      marketplaceId: a.marketplaceId ?? '',
      downloadUrl: '',
    }));
  }

  updateAssetState(id: string, enabled: 'enabled' | 'disabled', marketplaceId?: string): void {
    const key = marketplaceId ? `${marketplaceId}:${id}` : id;
    const asset = this._cache.get(key);
    if (asset) {
      asset.enabled = enabled;
      this._cache.set(key, asset);
    }
  }
}
