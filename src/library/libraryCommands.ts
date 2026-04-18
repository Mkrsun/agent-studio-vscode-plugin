import * as vscode from 'vscode';
import { AssetLoader } from '../services/assetLoader';
import { LibraryProvider } from './libraryProvider';
import { AssetNode } from './libraryTreeItem';
import { ConfigService } from '../services/configService';
import { ScopeService, AssetScope } from '../services/scopeService';
import { CopilotExporter } from '../services/copilotExporter';
import { COMMANDS } from '../constants';
import { Workflow } from '../models/types';
import { MarketplaceService } from '../marketplace/marketplaceService';

export function registerLibraryCommands(
  context: vscode.ExtensionContext,
  assetLoader: AssetLoader,
  libraryProvider: LibraryProvider,
  configService: ConfigService,
  scopeService: ScopeService,
  copilotExporter: CopilotExporter,
  marketplaceService: MarketplaceService,
): vscode.Disposable[] {
  return [

    // ── Refresh ─────────────────────────────────────────────────────────────
    vscode.commands.registerCommand(COMMANDS.REFRESH_LIBRARY, async () => {
      await marketplaceService.refresh();
      await assetLoader.loadAll();
      libraryProvider.refresh();
    }),

    // ── Install to .github/ ──────────────────────────────────────────────────
    vscode.commands.registerCommand(COMMANDS.ENABLE_ASSET, async (node: AssetNode) => {
      if (!node?.asset) return;
      await scopeService.setScope(node.asset.id, 'repo');
      const result = await copilotExporter.exportOne(node.asset.id, scopeService.getRepoScopedIds());
      if (result.ok) {
        vscode.window.showInformationMessage(
          `✅ "${node.asset.name}" installed to .github/`,
        );
      } else {
        await scopeService.setScope(node.asset.id, 'disabled');
        vscode.window.showErrorMessage(`Install failed: ${result.error}`);
      }
    }),

    // ── Uninstall from .github/ ──────────────────────────────────────────────
    vscode.commands.registerCommand(COMMANDS.DISABLE_ASSET, async (node: AssetNode) => {
      if (!node?.asset) return;
      await scopeService.setScope(node.asset.id, 'disabled');
      const result = await copilotExporter.removeOne(node.asset.id, scopeService.getRepoScopedIds());
      if (result.ok) {
        vscode.window.showInformationMessage(`🗑 "${node.asset.name}" uninstalled from .github/`);
      } else {
        vscode.window.showErrorMessage(`Uninstall failed: ${result.error}`);
      }
    }),

    // ── Preview ──────────────────────────────────────────────────────────────
    vscode.commands.registerCommand(COMMANDS.PREVIEW_ASSET, (node: AssetNode) => {
      if (!node?.asset) return;
      const asset = node.asset;
      vscode.workspace.openTextDocument({
        language: 'markdown',
        content: buildAssetPreview(asset, scopeService.getScope(asset.id)),
      }).then(d => vscode.window.showTextDocument(d, { preview: true }));
    }),

    // ── Inject into chat clipboard ────────────────────────────────────────────
    vscode.commands.registerCommand(COMMANDS.INJECT_ASSET, async (node: AssetNode) => {
      if (!node?.asset) return;
      const asset = node.asset;
      let text = '';
      if (asset.type === 'skill')       text = `@agent-studio /skill ${asset.id}`;
      else if (asset.type === 'agent')  text = `@agent-studio /agent ${asset.id}`;
      else if (asset.type === 'workflow') text = `@agent-studio /workflow ${(asset as Workflow).id}`;
      else text = `@agent-studio Apply "${asset.name}"`;
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage(`Copied to clipboard — paste into Copilot Chat`);
    }),

  ];
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
