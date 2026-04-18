import * as vscode from 'vscode';
import * as path from 'path';
import { MarketplaceDescriptor, MarketplaceAssetRef, MarketplaceRegistryJson } from './marketplaceTypes';

const GITHUB_API = 'https://api.github.com';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  registry: MarketplaceRegistryJson;
  fetchedAt: number;
}

const COMMON_HEADERS = {
  Accept: 'application/vnd.github.raw+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

/**
 * Fetches registry.json and individual asset files for a given marketplace.
 * Supports two source kinds:
 *   - "github": fetches via GitHub Contents API (authenticated).
 *   - "localPath": reads from disk (dev / test mode).
 *
 * Per-marketplace in-memory cache; TTL is 1 hour.
 */
export class MarketplaceClient {
  private readonly _cache = new Map<string, CacheEntry>();

  constructor(private readonly _getToken: () => Promise<string | null>) {}

  /**
   * Fetch the registry.json for the given marketplace.
   * Returns null on any error; caller inspects the error kind separately.
   */
  async fetchRegistry(
    descriptor: MarketplaceDescriptor,
    force = false,
  ): Promise<{ ok: true; registry: MarketplaceRegistryJson } | { ok: false; status: 'no-access' | 'unreachable' | 'malformed' }> {
    const cached = this._cache.get(descriptor.id);
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { ok: true, registry: cached.registry };
    }

    let raw: string;
    try {
      if (descriptor.localPath) {
        raw = await this._readLocalFile(descriptor.localPath, 'registry.json');
      } else if (descriptor.repo) {
        const result = await this._fetchGitHub(descriptor.repo, 'registry.json');
        if (!result.ok) return result;
        raw = result.text;
      } else {
        return { ok: false, status: 'unreachable' };
      }
    } catch {
      return { ok: false, status: 'unreachable' };
    }

    let registry: MarketplaceRegistryJson;
    try {
      registry = JSON.parse(raw) as MarketplaceRegistryJson;
      if (!registry.schemaVersion || !Array.isArray(registry.assets)) throw new Error('invalid');
    } catch {
      return { ok: false, status: 'malformed' };
    }

    this._cache.set(descriptor.id, { registry, fetchedAt: Date.now() });
    return { ok: true, registry };
  }

  /** Download the raw YAML content of a single asset. */
  async fetchAssetContent(
    descriptor: MarketplaceDescriptor,
    assetRef: MarketplaceAssetRef,
  ): Promise<string> {
    if (descriptor.localPath) {
      return this._readLocalFile(descriptor.localPath, assetRef.path);
    }
    if (descriptor.repo) {
      const result = await this._fetchGitHub(descriptor.repo, assetRef.path);
      if (!result.ok) throw new Error(`Failed to download asset ${assetRef.id} (${result.status})`);
      return result.text;
    }
    throw new Error('Marketplace descriptor has neither repo nor localPath');
  }

  /** Bust the in-memory cache for a specific marketplace. */
  invalidate(marketplaceId: string): void {
    this._cache.delete(marketplaceId);
  }

  invalidateAll(): void {
    this._cache.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async _fetchGitHub(
    repo: string,
    filePath: string,
  ): Promise<{ ok: true; text: string } | { ok: false; status: 'no-access' | 'unreachable' }> {
    const token = await this._getToken();
    const headers: Record<string, string> = { ...COMMON_HEADERS };
    if (token) headers.Authorization = `Bearer ${token}`;

    const url = `${GITHUB_API}/repos/${repo}/contents/${filePath}`;
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return { ok: false, status: 'no-access' };
      }
      if (!res.ok) return { ok: false, status: 'unreachable' };
      return { ok: true, text: await res.text() };
    } catch {
      return { ok: false, status: 'unreachable' };
    }
  }

  private async _readLocalFile(basePath: string, filePath: string): Promise<string> {
    const fullPath = path.join(basePath, filePath);
    const uri = vscode.Uri.file(fullPath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  }
}
