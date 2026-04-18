import { AssetType } from '../models/types';

/** How a marketplace source is fetched. */
export type MarketplaceSourceKind = 'github' | 'localPath';

/** Configuration entry for a single marketplace (stored in settings). */
export interface MarketplaceDescriptor {
  /** Unique stable identifier, e.g. "chile". */
  id: string;
  /** Human-readable label shown in the tree and webview, e.g. "Chile". */
  label: string;
  /**
   * GitHub repo in "owner/repo" form. Used when kind is "github".
   * Fetched via GitHub Contents API with the user's auth token.
   */
  repo?: string;
  /**
   * Absolute path to a local marketplace directory.
   * Used when kind is "localPath" — dev/test only.
   */
  localPath?: string;
}

/** A single asset entry as listed in a marketplace's registry.json. */
export interface MarketplaceAssetRef {
  id: string;
  type: AssetType;
  name: string;
  version: string;
  description: string;
  tags: string[];
  /** Path relative to the repo / localPath root, e.g. "skills/code-review.yaml". */
  path: string;
}

/** Shape of the registry.json at the root of each marketplace repo. */
export interface MarketplaceRegistryJson {
  schemaVersion: '1.0';
  marketplace: {
    id: string;
    name: string;
    updatedAt: string;
  };
  assets: MarketplaceAssetRef[];
  plugins: unknown[];
  mcpServers: unknown[];
}

/** Runtime state of a marketplace as seen by the plugin. */
export type MarketplaceStatus =
  | 'loading'
  | 'ready'
  | 'no-access'
  | 'unreachable'
  | 'malformed';

/** Fully resolved marketplace catalog entry, enriched with marketplaceId. */
export interface ResolvedMarketplace {
  descriptor: MarketplaceDescriptor;
  status: MarketplaceStatus;
  assets: MarketplaceAssetRef[];
  errorMessage?: string;
  fetchedAt?: number;
}
