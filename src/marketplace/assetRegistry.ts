import { AssetLoader } from '../services/assetLoader';
import { AssetType, RegistryAssetEntry } from '../models/types';

export class AssetRegistry {
  constructor(private assetLoader: AssetLoader) {}

  getCatalog(query?: string, typeFilter?: AssetType | 'all'): RegistryAssetEntry[] {
    let entries = this.assetLoader.getCatalogEntries();

    if (typeFilter && typeFilter !== 'all') {
      entries = entries.filter((e) => e.type === typeFilter);
    }

    if (query && query.trim().length > 0) {
      const q = query.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return entries;
  }

  isInstalled(assetId: string): boolean {
    const asset = this.assetLoader.getById(assetId);
    return asset?.source === 'workspace';
  }

  isEnabled(assetId: string): boolean {
    const asset = this.assetLoader.getById(assetId);
    return asset?.enabled === 'enabled';
  }
}
