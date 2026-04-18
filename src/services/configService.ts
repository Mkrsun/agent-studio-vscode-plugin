import * as vscode from 'vscode';

export class ConfigService {
  get<T>(key: string): T {
    return vscode.workspace.getConfiguration().get<T>(key) as T;
  }

  getEnabledAssets(): string[] {
    return this.get<string[]>('agentStudio.enabledAssets') ?? [];
  }

  getDisabledAssets(): string[] {
    return this.get<string[]>('agentStudio.disabledAssets') ?? [];
  }

  async setEnabledAssets(ids: string[]): Promise<void> {
    await vscode.workspace
      .getConfiguration()
      .update('agentStudio.enabledAssets', ids, vscode.ConfigurationTarget.Global);
  }

  async setDisabledAssets(ids: string[]): Promise<void> {
    await vscode.workspace
      .getConfiguration()
      .update('agentStudio.disabledAssets', ids, vscode.ConfigurationTarget.Global);
  }

  async enableAsset(id: string): Promise<void> {
    const enabled = new Set(this.getEnabledAssets());
    const disabled = new Set(this.getDisabledAssets());
    enabled.add(id);
    disabled.delete(id);
    await this.setEnabledAssets(Array.from(enabled));
    await this.setDisabledAssets(Array.from(disabled));
  }

  async disableAsset(id: string): Promise<void> {
    const enabled = new Set(this.getEnabledAssets());
    const disabled = new Set(this.getDisabledAssets());
    disabled.add(id);
    enabled.delete(id);
    await this.setEnabledAssets(Array.from(enabled));
    await this.setDisabledAssets(Array.from(disabled));
  }

  isAssetEnabled(id: string, defaultEnabled: boolean): boolean {
    const enabled = this.getEnabledAssets();
    const disabled = this.getDisabledAssets();
    if (disabled.includes(id)) return false;
    if (enabled.includes(id)) return true;
    return defaultEnabled;
  }

  getWorkspaceFolder(): string {
    return this.get<string>('agentStudio.workspaceAssetsFolder') ?? '.agent-studio';
  }

  getRemoteRegistryUrl(): string {
    return this.get<string>('agentStudio.remoteRegistryUrl') ?? '';
  }

  getMaxContextAssets(): number {
    return this.get<number>('agentStudio.maxContextAssets') ?? 5;
  }

  getDefaultWorkflow(): string {
    return this.get<string>('agentStudio.defaultWorkflow') ?? 'full-feature-workflow';
  }

  autoInjectEnabled(): boolean {
    return this.get<boolean>('agentStudio.autoInjectEnabledAssets') ?? true;
  }
}
