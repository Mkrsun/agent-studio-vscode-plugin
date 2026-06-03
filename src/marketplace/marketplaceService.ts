import * as vscode from 'vscode';
import { ConfigService } from '../services/configService';
import { CONFIG_KEYS } from '../constants';
import { MarketplaceClient } from './marketplaceClient';
import {
  MarketplaceDescriptor,
  MarketplaceAssetRef,
  ResolvedMarketplace,
} from './marketplaceTypes';

/**
 * Orchestrates all configured marketplaces. Loads them in parallel on
 * initialization, exposes resolved catalogs, and fires change events.
 * Consumers (AssetLoader, InspectorProvider, MarketplacePanel) listen to
 * onDidChangeCatalog and call getMarketplaces() / getAssetsForMarketplace().
 */
export class MarketplaceService implements vscode.Disposable {
  private readonly _onDidChangeCatalog = new vscode.EventEmitter<void>();
  readonly onDidChangeCatalog = this._onDidChangeCatalog.event;

  private _marketplaces: ResolvedMarketplace[] = [];
  private readonly _client: MarketplaceClient;
  private readonly _subs: vscode.Disposable[] = [];

  constructor(
    private readonly _config: ConfigService,
    getToken: () => Promise<string | null>,
  ) {
    this._client = new MarketplaceClient(getToken);

    // Re-load when the marketplace list setting changes.
    this._subs.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_KEYS.MARKETPLACES)) {
          void this.refresh();
        }
      }),
    );
  }

  /** Initial load — call once after construction. */
  async initialize(): Promise<void> {
    await this.refresh();
  }

  /** Force-refresh all marketplaces (busts cache). */
  async refresh(): Promise<void> {
    this._client.invalidateAll();
    const descriptors = this._getDescriptors();

    // Seed with loading state immediately so the tree can render spinners.
    this._marketplaces = descriptors.map((d) => ({
      descriptor: d,
      status: 'loading',
      assets: [],
    }));
    this._onDidChangeCatalog.fire();

    // Fetch all in parallel.
    const results = await Promise.all(
      descriptors.map((d) => this._loadOne(d)),
    );
    this._marketplaces = results;
    this._onDidChangeCatalog.fire();
  }

  /** Returns a snapshot of all configured marketplaces with their status. */
  getMarketplaces(): ResolvedMarketplace[] {
    return [...this._marketplaces];
  }

  /** Returns all assets across all ready marketplaces, with marketplaceId attached. */
  getAllAssetRefs(): Array<MarketplaceAssetRef & { marketplaceId: string }> {
    return this._marketplaces
      .filter((m) => m.status === 'ready')
      .flatMap((m) =>
        m.assets.map((a) => ({ ...a, marketplaceId: m.descriptor.id })),
      );
  }

  /** Download raw YAML for a specific asset from its marketplace. */
  async fetchAssetContent(
    marketplaceId: string,
    assetRef: MarketplaceAssetRef,
  ): Promise<string> {
    const marketplace = this._marketplaces.find(
      (m) => m.descriptor.id === marketplaceId,
    );
    if (!marketplace) throw new Error(`Unknown marketplace: ${marketplaceId}`);
    return this._client.fetchAssetContent(marketplace.descriptor, assetRef);
  }

  dispose(): void {
    this._subs.forEach((d) => d.dispose());
    this._onDidChangeCatalog.dispose();
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private _getDescriptors(): MarketplaceDescriptor[] {
    // Resolution order (env wins so ops/CI configure repos via .env, no settings edit):
    //   1. AGENT_STUDIO_MARKETPLACES   — full list, "id:Label:owner/repo, …" or JSON
    //   2. AGENT_STUDIO_MARKETPLACE_REPO — single content repo shorthand
    //   3. agentStudio.marketplaces      — VS Code settings
    const fromEnv = this._config.getMarketplacesFromEnv();
    if (fromEnv.length > 0) {
      return fromEnv.map((m) => ({ id: m.id, label: m.label, repo: m.repo }));
    }
    const override = this._config.getMarketplaceRepoOverride();
    if (override) {
      return [{ id: 'agentic-studio', label: 'Agentic Studio Assets', repo: override }];
    }
    return (
      this._config.get<MarketplaceDescriptor[]>(CONFIG_KEYS.MARKETPLACES) ?? []
    );
  }

  private async _loadOne(descriptor: MarketplaceDescriptor): Promise<ResolvedMarketplace> {
    const result = await this._client.fetchRegistry(descriptor);
    if (!result.ok) {
      return {
        descriptor,
        status: result.status,
        assets: [],
        errorMessage: this._statusMessage(result.status, descriptor),
      };
    }
    return {
      descriptor,
      status: 'ready',
      assets: result.registry.assets,
      fetchedAt: Date.now(),
    };
  }

  private _statusMessage(
    status: 'no-access' | 'unreachable' | 'malformed',
    descriptor: MarketplaceDescriptor,
  ): string {
    const src = descriptor.repo ?? descriptor.localPath ?? descriptor.id;
    switch (status) {
      case 'no-access':
        return `No access to ${src}. Check your GitHub permissions or the repo name.`;
      case 'unreachable':
        return `Could not reach ${src}. Check your network connection.`;
      case 'malformed':
        return `registry.json in ${src} is invalid. Contact the marketplace maintainer.`;
    }
  }
}
