import * as vscode from 'vscode';
import { Asset, AssetType } from '../models/types';
import { AssetScope } from '../services/scopeService';
import { ASSET_TYPE_LABELS, ASSET_TYPE_ICONS, COMMANDS } from '../constants';
import { InstalledPluginRecord, PLUGIN_TYPE_LABELS, DOC_LABELS } from '../marketplace/pluginTypes';
import { McpServerDefinition } from '../marketplace/mcpInstaller';
import { ResolvedMarketplace, MarketplaceStatus } from '../marketplace/marketplaceTypes';

export abstract class InspectorNode {
  abstract toTreeItem(): vscode.TreeItem;
}

// ── Marketplace group node (top-level in tree) ────────────────────────────────

const STATUS_ICONS: Record<MarketplaceStatus, string> = {
  loading: 'loading~spin',
  ready: 'globe',
  'no-access': 'lock',
  unreachable: 'warning',
  malformed: 'error',
};

const STATUS_DESCRIPTIONS: Record<MarketplaceStatus, string> = {
  loading: 'Loading…',
  ready: '',
  'no-access': 'No access',
  unreachable: 'Unreachable',
  malformed: 'Invalid registry',
};

export class MarketplaceGroupNode extends InspectorNode {
  constructor(
    public readonly marketplace: ResolvedMarketplace,
    /** True when this group has nested child marketplaces (so it expands even with 0 own assets). */
    public readonly hasChildGroups: boolean = false,
  ) {
    super();
  }

  toTreeItem(): vscode.TreeItem {
    const { descriptor, status, assets, errorMessage } = this.marketplace;
    const isReady = status === 'ready';
    const expandable = (isReady && assets.length > 0) || this.hasChildGroups;
    const item = new vscode.TreeItem(
      descriptor.label,
      expandable
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon(STATUS_ICONS[status]);
    item.contextValue = `marketplace-${status}`;
    if (STATUS_DESCRIPTIONS[status]) {
      item.description = STATUS_DESCRIPTIONS[status];
    }
    if (isReady) {
      item.description = `${assets.length} asset${assets.length !== 1 ? 's' : ''}`;
      item.tooltip = new vscode.MarkdownString(
        `**${descriptor.label}**\n\n${assets.length} assets available.\n\n` +
          (descriptor.repo ? `*Source: \`${descriptor.repo}\`*` : `*Source: local*`),
      );
    } else if (errorMessage) {
      item.tooltip = new vscode.MarkdownString(`**${descriptor.label}**\n\n⚠️ ${errorMessage}`);
    }
    return item;
  }
}

// ── Plugin nodes (GitHub Copilot CLI plugins) ─────────────────────────────

/** Root category node for the Plugins section in the sidebar. */
export class PluginCategoryNode extends InspectorNode {
  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      ASSET_TYPE_LABELS['plugin'],
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.iconPath = new vscode.ThemeIcon(ASSET_TYPE_ICONS['plugin']);
    item.contextValue = 'category-plugin';
    item.tooltip = new vscode.MarkdownString(
      `**Plugins** — GitHub Copilot CLI plugin packages\n\n` +
      `Each plugin bundles agents, skills, hooks, and MCP configurations.\n\n` +
      `*Click to browse the Marketplace → Plugins tab.*`,
    );
    item.command = {
      command: COMMANDS.OPEN_MARKETPLACE,
      title: 'Browse Plugins in Marketplace',
      arguments: [{ tab: 'plugins' }],
    };
    return item;
  }
}

const COMPONENT_ICONS: Record<string, string> = {
  agents: '$(robot)',
  skills: '$(tools)',
  hooks: '$(zap)',
  mcp: '$(plug)',
  lsp: '$(symbol-method)',
};

/** Node for a single installed plugin. */
export class InstalledPluginNode extends InspectorNode {
  constructor(public readonly record: InstalledPluginRecord) {
    super();
  }

  toTreeItem(): vscode.TreeItem {
    const isFramework = this.record.type === 'framework';
    const item = new vscode.TreeItem(
      this.record.name,
      vscode.TreeItemCollapsibleState.None,
    );

    const typeLabel = PLUGIN_TYPE_LABELS[this.record.type] ?? 'Plugin';
    item.description = `${typeLabel} · v${this.record.version}`;
    item.tooltip = this._buildTooltip();
    item.contextValue = 'plugin-installed';

    item.iconPath = new vscode.ThemeIcon(
      isFramework ? 'circuit-board' : 'package',
      new vscode.ThemeColor('testing.iconPassed'),
    );

    item.command = {
      command: COMMANDS.OPEN_MARKETPLACE,
      title: 'Browse Plugins in Marketplace',
      arguments: [{ tab: 'plugins' }],
    };

    return item;
  }

  private _buildTooltip(): vscode.MarkdownString {
    const { record: r } = this;
    const lines: string[] = [];

    const typeLabel = PLUGIN_TYPE_LABELS[r.type] ?? 'Plugin';
    lines.push(`**${r.name}** *(${typeLabel} · v${r.version})*\n`);
    lines.push(`${r.description}\n`);

    // Components
    if (r.components.length > 0) {
      const comps = r.components.map(c => `${COMPONENT_ICONS[c] ?? ''} ${c}`).join('  ·  ');
      lines.push(`**Contains:** ${comps}\n`);
    }

    // Phases (frameworks)
    if (r.phases && r.phases.length > 0) {
      lines.push(`**Phases:** ${r.phases.join(' → ')}\n`);
    }

    // Agents
    if (r.agentCount) {
      const { orchestrators, specialists } = r.agentCount;
      lines.push(`**Agents:** ${orchestrators} orchestrator${orchestrators !== 1 ? 's' : ''} + ${specialists} specialist${specialists !== 1 ? 's' : ''}\n`);
    }

    // Documents generated
    if (r.generates && r.generates.length > 0) {
      const docs = r.generates.map(d => DOC_LABELS[d] ?? d).join(' · ');
      lines.push(`**Generates:** ${docs}\n`);
    }

    // Domains
    if (r.domains && r.domains.length > 0) {
      lines.push(`*Domains: ${r.domains.join(', ')}*\n`);
    }

    const date = new Date(r.installedAt).toLocaleDateString();
    lines.push(`**Source:** \`${r.marketplaceRepo}/${r.source}\`\n`);
    lines.push(`*Installed ${date}*`);

    const md = new vscode.MarkdownString(lines.join('\n'));
    md.isTrusted = true;
    return md;
  }
}

/** Shown when no plugins are installed yet. */
export class NoPluginsNode extends InspectorNode {
  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem('No plugins installed');
    item.description = 'Open Marketplace → Plugins to browse';
    item.iconPath = new vscode.ThemeIcon('info');
    item.command = {
      command: COMMANDS.OPEN_MARKETPLACE,
      title: 'Open Marketplace',
      arguments: [{ tab: 'plugins' }],
    };
    return item;
  }
}

export class CategoryNode extends InspectorNode {
  constructor(
    public readonly assetType: AssetType,
    public readonly marketplaceId?: string,
  ) {
    super();
  }

  toTreeItem(): vscode.TreeItem {
    const label = ASSET_TYPE_LABELS[this.assetType] ?? this.assetType;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon(ASSET_TYPE_ICONS[this.assetType] ?? 'folder');
    item.contextValue = `category-${this.assetType}`;
    item.tooltip = `Browse ${label} in the Marketplace`;
    item.command = {
      command: COMMANDS.OPEN_MARKETPLACE,
      title: `Browse ${label}`,
      arguments: [{ tab: 'assets', assetType: this.assetType }],
    };
    return item;
  }
}

/** Root category node for the MCP Servers section in the sidebar. */
export class McpCategoryNode extends InspectorNode {
  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      ASSET_TYPE_LABELS['mcp-server'],
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.iconPath = new vscode.ThemeIcon(ASSET_TYPE_ICONS['mcp-server']);
    item.contextValue = 'category-mcp-server';
    item.tooltip = new vscode.MarkdownString(
      `**MCP Servers** — Model Context Protocol server connections\n\n` +
      `Installed MCP servers expose tools to Copilot agent mode (written to \`.vscode/mcp.json\`).\n\n` +
      `*Click to browse the Marketplace → MCP Servers tab.*`,
    );
    item.command = {
      command: COMMANDS.OPEN_MARKETPLACE,
      title: 'Browse MCP Servers in Marketplace',
      arguments: [{ tab: 'mcp' }],
    };
    return item;
  }
}

/** Shown when no MCP servers are installed yet. */
export class NoMcpNode extends InspectorNode {
  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem('No MCP servers installed');
    item.description = 'Open Marketplace → MCP Servers to browse';
    item.iconPath = new vscode.ThemeIcon('info');
    item.command = {
      command: COMMANDS.OPEN_MARKETPLACE,
      title: 'Open Marketplace',
      arguments: [{ tab: 'mcp' }],
    };
    return item;
  }
}

/** Node for a single installed MCP server. */
export class InstalledMcpNode extends InspectorNode {
  constructor(public readonly server: McpServerDefinition) {
    super();
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.server.name, vscode.TreeItemCollapsibleState.None);
    item.description = this.server.tags.slice(0, 3).join(', ');
    item.tooltip = this._buildTooltip();
    item.contextValue = 'mcp-server-installed';
    item.iconPath = new vscode.ThemeIcon('plug', new vscode.ThemeColor('testing.iconPassed'));
    item.command = {
      command: COMMANDS.OPEN_MARKETPLACE,
      title: 'Browse MCP Servers in Marketplace',
      arguments: [{ tab: 'mcp' }],
    };
    return item;
  }

  private _buildTooltip(): vscode.MarkdownString {
    const { server: s } = this;
    const cmd = `\`${s.command} ${s.args.slice(0, 2).join(' ')}\``;
    const md = new vscode.MarkdownString(
      `**${s.name}**\n\n` +
      `${s.description}\n\n` +
      `**Command:** ${cmd}\n\n` +
      (s.installDocs ? `[Docs](${s.installDocs})\n\n` : '') +
      `*Tags: ${s.tags.join(', ')}*`,
    );
    md.isTrusted = true;
    return md;
  }
}

export class AssetNode extends InspectorNode {
  constructor(
    public readonly asset: Asset,
    public readonly scope: AssetScope,
  ) {
    super();
  }

  get isInstalled(): boolean {
    return this.scope === 'repo';
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.asset.name, vscode.TreeItemCollapsibleState.None);
    item.description = this._statusLabel();
    item.tooltip = this._buildTooltip();

    // contextValue distinguishes installed vs available for menu targeting
    item.contextValue = this.isInstalled ? 'asset-installed' : 'asset-available';

    item.iconPath = new vscode.ThemeIcon(
      this.isInstalled ? 'check' : 'circle-outline',
      new vscode.ThemeColor(this.isInstalled ? 'testing.iconPassed' : 'descriptionForeground'),
    );

    item.command = {
      command: COMMANDS.OPEN_MARKETPLACE,
      title: 'Browse in Marketplace',
      arguments: [{ tab: 'assets', assetType: this.asset.type }],
    };

    return item;
  }

  private _statusLabel(): string {
    const status = this.isInstalled ? 'Installed' : 'Available';
    return `${this.asset.source === 'workspace' ? '📁 ' : ''}v${this.asset.version} · ${status}`;
  }

  private _buildTooltip(): vscode.MarkdownString {
    const statusEmoji = this.isInstalled ? '🟢' : '⚪';
    const statusLabel = this.isInstalled ? 'Installed' : 'Available';
    const md = new vscode.MarkdownString(
      `**${this.asset.name}** *(${this.asset.type})*\n\n` +
      `${this.asset.description}\n\n` +
      `${statusEmoji} **Status:** ${statusLabel}\n\n` +
      (this.isInstalled
        ? `> Exported to \`.github/\` — active in all Copilot features.\n\n`
        : `> Not installed. Right-click → Install to export into \`.github/\`.\n\n`) +
      (this.asset.tags?.length ? `*Tags: ${this.asset.tags.join(', ')}*` : ''),
    );
    md.isTrusted = true;
    return md;
  }
}
