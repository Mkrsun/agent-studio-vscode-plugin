import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigService } from './configService';

export class WorkspaceService {
  constructor(private config: ConfigService) {}

  getWorkspaceFolderUri(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return folders[0].uri;
  }

  getAssetsFolderUri(): vscode.Uri | undefined {
    const root = this.getWorkspaceFolderUri();
    if (!root) return undefined;
    return vscode.Uri.joinPath(root, this.config.getWorkspaceFolder());
  }

  async ensureAssetsFolderExists(): Promise<vscode.Uri | undefined> {
    const folderUri = this.getAssetsFolderUri();
    if (!folderUri) return undefined;
    try {
      await vscode.workspace.fs.createDirectory(folderUri);
    } catch {
      // Already exists
    }
    return folderUri;
  }

  async readFile(uri: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf-8');
  }

  async writeFile(uri: vscode.Uri, content: string): Promise<void> {
    const bytes = Buffer.from(content, 'utf-8');
    await vscode.workspace.fs.writeFile(uri, bytes);
  }

  async deleteFile(uri: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.delete(uri);
  }

  async listYamlFiles(dirUri: vscode.Uri): Promise<vscode.Uri[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      return [];
    }
    const uris: vscode.Uri[] = [];
    for (const [name, type] of entries) {
      if (type === vscode.FileType.File && (name.endsWith('.yaml') || name.endsWith('.yml'))) {
        uris.push(vscode.Uri.joinPath(dirUri, name));
      } else if (type === vscode.FileType.Directory) {
        const sub = vscode.Uri.joinPath(dirUri, name);
        const subFiles = await this.listYamlFiles(sub);
        uris.push(...subFiles);
      }
    }
    return uris;
  }

  getAssetFilename(assetId: string, assetType: string): string {
    return path.join(assetType + 's', `${assetId}.yaml`);
  }
}
