import * as vscode from 'vscode';
import * as path from 'path';
import { AssetLoader } from '../services/assetLoader';
import { WorkspaceService } from '../services/workspaceService';
import { ConfigService } from '../services/configService';
import { MarketplaceService } from './marketplaceService';

export class AssetInstaller {
  private workspaceService: WorkspaceService;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly assetLoader: AssetLoader,
    private readonly configService: ConfigService,
    private readonly marketplaceService: MarketplaceService,
  ) {
    this.workspaceService = new WorkspaceService(configService);
  }

  async installAsset(assetId: string, marketplaceId?: string): Promise<void> {
    const asset = this.assetLoader.getById(assetId, marketplaceId);
    if (!asset) throw new Error(`Asset not found: ${assetId}`);
    if (asset.source === 'workspace') return; // Already installed

    const folderUri = await this.workspaceService.ensureAssetsFolderExists();
    if (!folderUri) throw new Error('No workspace folder open');

    // Resolve effective marketplaceId (asset may carry it from loading).
    const mktId = marketplaceId ?? asset.marketplaceId;

    let content: string;
    if (mktId) {
      // Fetch the YAML from the marketplace.
      const refs = this.marketplaceService.getAllAssetRefs();
      const ref = refs.find((r) => r.id === assetId && r.marketplaceId === mktId);
      if (!ref) throw new Error(`Asset ref not found in marketplace ${mktId}: ${assetId}`);
      content = await this.marketplaceService.fetchAssetContent(mktId, ref);
    } else {
      throw new Error(`Cannot install asset ${assetId}: no marketplace source.`);
    }

    // Write to .agent-studio/<marketplaceId>/<type>s/<id>.yaml
    const typeSubdir = asset.type + 's';
    const destDir = vscode.Uri.joinPath(folderUri, mktId, typeSubdir);
    try {
      await vscode.workspace.fs.createDirectory(destDir);
    } catch {
      // Already exists.
    }

    const destUri = vscode.Uri.joinPath(destDir, `${assetId}.yaml`);
    await this.workspaceService.writeFile(destUri, content);

    await this.assetLoader.loadAll();
  }

  async uninstallAsset(assetId: string, marketplaceId?: string): Promise<void> {
    const asset = this.assetLoader.getById(assetId, marketplaceId);
    if (!asset || asset.source !== 'workspace') {
      throw new Error(`Asset ${assetId} is not a workspace asset and cannot be uninstalled`);
    }

    const folderUri = this.workspaceService.getAssetsFolderUri();
    if (!folderUri) throw new Error('No workspace folder open');

    const mktId = marketplaceId ?? asset.marketplaceId;
    const subPath = mktId
      ? path.join(mktId, asset.type + 's', `${assetId}.yaml`)
      : path.join(asset.type + 's', `${assetId}.yaml`);

    const fileUri = vscode.Uri.joinPath(folderUri, subPath);
    await this.workspaceService.deleteFile(fileUri);

    await this.assetLoader.loadAll();
  }
}
