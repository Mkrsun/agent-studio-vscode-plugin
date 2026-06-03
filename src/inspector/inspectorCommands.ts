import * as vscode from 'vscode';
import { AssetLoader } from '../services/assetLoader';
import { InspectorProvider } from './inspectorProvider';
import { AssetNode } from './inspectorTreeItem';
import { ConfigService } from '../services/configService';
import { ScopeService, AssetScope } from '../services/scopeService';
import { CopilotExporter } from '../services/copilotExporter';
import { COMMANDS } from '../constants';
import { Workflow } from '../models/types';
import { MarketplaceService } from '../marketplace/marketplaceService';
import { recordAsset } from '../analytics/metrics';

/**
 * Wires the Inspector context-menu commands. Each handler is its own named
 * function below; this list is just the wiring.
 */
export function registerInspectorCommands(
  _context: vscode.ExtensionContext,
  assetLoader: AssetLoader,
  inspectorProvider: InspectorProvider,
  _configService: ConfigService,
  scopeService: ScopeService,
  copilotExporter: CopilotExporter,
  marketplaceService: MarketplaceService,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMANDS.REFRESH_INSPECTOR, () =>
      refreshInspector(marketplaceService, assetLoader, inspectorProvider),
    ),
    vscode.commands.registerCommand(COMMANDS.ENABLE_ASSET, (node: AssetNode) =>
      installAsset(node, scopeService, copilotExporter),
    ),
    vscode.commands.registerCommand(COMMANDS.DISABLE_ASSET, (node: AssetNode) =>
      uninstallAsset(node, scopeService, copilotExporter),
    ),
    vscode.commands.registerCommand(COMMANDS.PREVIEW_ASSET, (node: AssetNode) =>
      previewAsset(node, scopeService),
    ),
    vscode.commands.registerCommand(COMMANDS.INJECT_ASSET, (node: AssetNode) => injectAsset(node)),
  ];
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function refreshInspector(
  marketplaceService: MarketplaceService,
  assetLoader: AssetLoader,
  inspectorProvider: InspectorProvider,
): Promise<void> {
  await marketplaceService.refresh();
  await assetLoader.loadAll();
  inspectorProvider.refresh();
}

/** Install: scope to repo + export to .github/; revert the scope on failure. */
async function installAsset(
  node: AssetNode,
  scopeService: ScopeService,
  copilotExporter: CopilotExporter,
): Promise<void> {
  if (!node?.asset) return;
  await scopeService.setScope(node.asset.id, 'repo');
  const result = await copilotExporter.exportOne(node.asset.id, scopeService.getRepoScopedIds());
  if (result.ok) {
    recordAsset({ event: 'install', assetId: node.asset.id, assetType: node.asset.type, marketplace: node.asset.marketplaceId });
    vscode.window.showInformationMessage(`✅ "${node.asset.name}" installed to .github/`);
  } else {
    await scopeService.setScope(node.asset.id, 'disabled');
    vscode.window.showErrorMessage(`Install failed: ${result.error}`);
  }
}

async function uninstallAsset(
  node: AssetNode,
  scopeService: ScopeService,
  copilotExporter: CopilotExporter,
): Promise<void> {
  if (!node?.asset) return;
  await scopeService.setScope(node.asset.id, 'disabled');
  const result = await copilotExporter.removeOne(node.asset.id, scopeService.getRepoScopedIds());
  if (result.ok) {
    recordAsset({ event: 'uninstall', assetId: node.asset.id, assetType: node.asset.type, marketplace: node.asset.marketplaceId });
    vscode.window.showInformationMessage(`🗑 "${node.asset.name}" uninstalled from .github/`);
  } else {
    vscode.window.showErrorMessage(`Uninstall failed: ${result.error}`);
  }
}

async function previewAsset(node: AssetNode, scopeService: ScopeService): Promise<void> {
  if (!node?.asset) return;
  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: buildAssetPreview(node.asset, scopeService.getScope(node.asset.id)),
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

/** Copy the chat command that applies this asset to the clipboard. */
async function injectAsset(node: AssetNode): Promise<void> {
  if (!node?.asset) return;
  await vscode.env.clipboard.writeText(chatCommandFor(node.asset));
  vscode.window.showInformationMessage('Copied to clipboard — paste into Copilot Chat');
}

function chatCommandFor(asset: AssetNode['asset']): string {
  switch (asset.type) {
    case 'skill':    return `@agent-studio /skill ${asset.id}`;
    case 'agent':    return `@agent-studio /agent ${asset.id}`;
    case 'workflow': return `@agent-studio /workflow ${(asset as Workflow).id}`;
    default:         return `@agent-studio Apply "${asset.name}"`;
  }
}

// ── Asset preview builder ─────────────────────────────────────────────────────

function buildAssetPreview(
  asset: ReturnType<AssetLoader['getAll']>[number],
  scope: AssetScope,
): string {
  const installed = scope === 'repo';
  const statusEmoji = installed ? '🟢' : '⚪';
  const statusLabel = installed ? 'Installed' : 'Available';

  const lines: string[] = [
    `# ${asset.name}`,
    `> **Type**: ${asset.type} | **Version**: v${asset.version} | **Source**: ${asset.source}`,
    `> **Status**: ${statusEmoji} ${statusLabel}`,
    ``,
    asset.description,
    ``,
  ];

  if (asset.tags?.length) {
    lines.push(`**Tags**: ${asset.tags.map(t => `\`${t}\``).join(', ')}`, ``);
  }

  if (asset.type === 'skill') {
    lines.push('## System Prompt', '```', asset.systemPrompt, '```');
    if (asset.userPromptTemplate) {
      lines.push('', '## User Prompt Template', '```', asset.userPromptTemplate, '```');
    }
    if (asset.bestPractices?.length) {
      lines.push('', '## Best Practices');
      lines.push(...asset.bestPractices.map(p => `- ${p}`));
    }
  } else if (asset.type === 'agent') {
    lines.push(`**Role**: ${asset.role}`, '', '## System Prompt', '```', asset.systemPrompt, '```');
    if (asset.capabilities?.length) {
      lines.push('', '## Capabilities');
      lines.push(...asset.capabilities.map(c => `- **${c.name}**: ${c.description}`));
    }
  } else if (asset.type === 'workflow') {
    lines.push(`**Entry Phase**: ${asset.entryPhase}`, `**Phases**: ${asset.phases.join(' → ')}`);
    if (asset.triggerPhrases?.length) {
      lines.push('', '**Trigger Phrases**:');
      lines.push(...asset.triggerPhrases.map(p => `- "${p}"`));
    }
    lines.push('', '## Steps');
    for (const step of asset.steps) {
      lines.push(`### ${step.name} *(${step.phase})*`, step.prompt.trim());
      if (step.agentId) lines.push(`\n*Agent: \`${step.agentId}\`*`);
    }
  } else if (asset.type === 'instruction') {
    lines.push(`**Scope**: ${asset.scope} | **Priority**: ${asset.priority}`);
    if (asset.languageIds?.length) lines.push(`**Languages**: ${asset.languageIds.join(', ')}`);
    lines.push('', '## Content', asset.content);
  } else if (asset.type === 'hook') {
    lines.push(`**Trigger**: ${asset.trigger} | **Action**: ${asset.action}`);
    lines.push('', '## Payload', '```', asset.payload, '```');
  }

  return lines.join('\n');
}
