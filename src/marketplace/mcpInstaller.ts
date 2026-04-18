import * as vscode from 'vscode';

export interface McpServerDefinition {
  id: string;
  name: string;
  description: string;
  tags: string[];
  command: string;
  args: string[];
  env?: Record<string, string>;
  requiresNpx?: boolean;
  requiresUvx?: boolean;
  installDocs?: string;
}

/**
 * Installs MCP (Model Context Protocol) servers into VS Code's MCP configuration.
 * VS Code Copilot reads this config and exposes the tools to the agent.
 *
 * Config target: workspace .vscode/mcp.json  (preferred — checked into repo)
 *                OR user settings.json (global fallback)
 */
export class McpInstaller {
  private _installed = new Map<string, McpServerDefinition>();
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  getInstalled(): McpServerDefinition[] {
    return Array.from(this._installed.values());
  }

  isInstalledSync(serverId: string): boolean {
    return this._installed.has(serverId);
  }

  async install(server: McpServerDefinition): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

    if (workspaceRoot) {
      await this._installToWorkspaceMcpJson(workspaceRoot, server);
    } else {
      await this._installToUserSettings(server);
    }

    this._installed.set(server.id, server);
    this._onDidChange.fire();
  }

  async uninstall(serverId: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (workspaceRoot) {
      await this._removeFromWorkspaceMcpJson(workspaceRoot, serverId);
    }
    await this._removeFromUserSettings(serverId);

    this._installed.delete(serverId);
    this._onDidChange.fire();
  }

  async isInstalled(serverId: string): Promise<boolean> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (workspaceRoot) {
      const mcpJson = await this._readMcpJson(workspaceRoot);
      if (mcpJson?.servers?.[serverId]) return true;
    }
    const userMcp = vscode.workspace.getConfiguration('mcp');
    const userServers = userMcp.get<Record<string, unknown>>('servers') ?? {};
    return serverId in userServers;
  }

  // ── .vscode/mcp.json ──────────────────────────────────────────────────────

  private async _installToWorkspaceMcpJson(
    root: vscode.Uri,
    server: McpServerDefinition,
  ): Promise<void> {
    const vscodDir = vscode.Uri.joinPath(root, '.vscode');
    try { await vscode.workspace.fs.createDirectory(vscodDir); } catch { /* exists */ }

    const mcpJson = await this._readMcpJson(root) ?? { servers: {} };
    mcpJson.servers ??= {};
    mcpJson.servers[server.id] = this._buildServerConfig(server);

    const uri = vscode.Uri.joinPath(vscodDir, 'mcp.json');
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(mcpJson, null, 2), 'utf-8'),
    );
  }

  private async _removeFromWorkspaceMcpJson(root: vscode.Uri, serverId: string): Promise<void> {
    const mcpJson = await this._readMcpJson(root);
    if (!mcpJson?.servers?.[serverId]) return;
    delete mcpJson.servers[serverId];
    const uri = vscode.Uri.joinPath(root, '.vscode', 'mcp.json');
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(mcpJson, null, 2), 'utf-8'),
    );
  }

  private async _readMcpJson(root: vscode.Uri): Promise<Record<string, any> | null> {
    try {
      const uri = vscode.Uri.joinPath(root, '.vscode', 'mcp.json');
      const raw = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(raw).toString('utf-8'));
    } catch {
      return null;
    }
  }

  // ── User settings fallback ────────────────────────────────────────────────

  private async _installToUserSettings(server: McpServerDefinition): Promise<void> {
    const config = vscode.workspace.getConfiguration('mcp');
    const existing = config.get<Record<string, unknown>>('servers') ?? {};
    existing[server.id] = this._buildServerConfig(server);
    await config.update('servers', existing, vscode.ConfigurationTarget.Global);
  }

  private async _removeFromUserSettings(serverId: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('mcp');
    const existing = config.get<Record<string, unknown>>('servers') ?? {};
    if (!(serverId in existing)) return;
    delete existing[serverId];
    await config.update('servers', existing, vscode.ConfigurationTarget.Global);
  }

  private _buildServerConfig(server: McpServerDefinition): Record<string, unknown> {
    const cfg: Record<string, unknown> = {
      command: server.command,
      args: server.args,
    };
    if (server.env && Object.keys(server.env).length > 0) {
      cfg['env'] = server.env;
    }
    return cfg;
  }
}

// ── Curated MCP server catalog ────────────────────────────────────────────────

export const MCP_CATALOG: McpServerDefinition[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read/write files and directories — gives Copilot full workspace file access',
    tags: ['core', 'files', 'official'],
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '${workspaceFolder}'],
    requiresNpx: true,
    installDocs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Search repos, read files, list PRs, issues, and commits via GitHub API',
    tags: ['core', 'github', 'official'],
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    requiresNpx: true,
    installDocs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Query PostgreSQL databases — schema introspection + read-only SQL execution',
    tags: ['database', 'sql', 'official'],
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
    requiresNpx: true,
    installDocs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search via Brave — lets Copilot look things up in real time',
    tags: ['search', 'web', 'official'],
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '' },
    requiresNpx: true,
    installDocs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'memory',
    name: 'Memory (Knowledge Graph)',
    description: 'Persistent memory across sessions using a local knowledge graph',
    tags: ['memory', 'context', 'official'],
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    requiresNpx: true,
    installDocs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Structured multi-step reasoning — improves complex problem solving',
    tags: ['reasoning', 'planning', 'official'],
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    requiresNpx: true,
    installDocs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer (Browser)',
    description: 'Control a browser — screenshot, navigate, fill forms, extract page content',
    tags: ['browser', 'testing', 'scraping', 'official'],
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    requiresNpx: true,
    installDocs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read channels, threads, and send messages via Slack API',
    tags: ['communication', 'slack', 'official'],
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
    requiresNpx: true,
    installDocs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
  {
    id: 'context7',
    name: 'Context7 (Library Docs)',
    description: 'Fetch up-to-date docs for any npm/PyPI library directly into context',
    tags: ['docs', 'libraries', 'community'],
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    requiresNpx: true,
    installDocs: 'https://github.com/upstash/context7',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Read and create Linear issues, projects, and team data',
    tags: ['project-management', 'linear', 'community'],
    command: 'npx',
    args: ['-y', 'linear-mcp-server'],
    env: { LINEAR_API_KEY: '' },
    requiresNpx: true,
    installDocs: 'https://github.com/jerhadf/linear-mcp-server',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Query Sentry error events, stack traces, and project stats',
    tags: ['monitoring', 'errors', 'community'],
    command: 'uvx',
    args: ['mcp-server-sentry', '--auth-token', '${input:SENTRY_TOKEN}'],
    requiresUvx: true,
    installDocs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sentry',
  },
];

// ── GitHub Copilot Extension catalog ─────────────────────────────────────────

export interface CopilotExtension {
  id: string;
  name: string;
  publisher: string;
  description: string;
  tags: string[];
  marketplaceUrl: string;
  logoUrl?: string;
  category: string;
}

export const COPILOT_EXTENSIONS_CATALOG: CopilotExtension[] = [
  {
    id: 'github-copilot-azure',
    name: 'Azure',
    publisher: 'Microsoft',
    description: 'Deploy to Azure, query resources, manage services — @azure in Copilot Chat',
    tags: ['cloud', 'azure', 'microsoft', 'official'],
    marketplaceUrl: 'https://github.com/marketplace/azure-copilot-extension',
    category: 'Cloud',
  },
  {
    id: 'github-copilot-docker',
    name: 'Docker',
    publisher: 'Docker',
    description: 'Build, analyze and fix Docker images, Compose files, and deployments',
    tags: ['containers', 'docker', 'devops', 'official'],
    marketplaceUrl: 'https://github.com/marketplace/docker-for-github-copilot',
    category: 'DevOps',
  },
  {
    id: 'github-copilot-sentry',
    name: 'Sentry',
    publisher: 'Sentry',
    description: 'Investigate errors, analyze stack traces, fix bugs from Sentry events',
    tags: ['monitoring', 'errors', 'debugging', 'official'],
    marketplaceUrl: 'https://github.com/marketplace/sentry-for-copilot',
    category: 'Monitoring',
  },
  {
    id: 'github-copilot-datadog',
    name: 'Datadog',
    publisher: 'Datadog',
    description: 'Query metrics, logs, traces, and monitors from Datadog',
    tags: ['monitoring', 'observability', 'official'],
    marketplaceUrl: 'https://github.com/marketplace/datadog-for-copilot',
    category: 'Monitoring',
  },
  {
    id: 'github-copilot-jira',
    name: 'Jira',
    publisher: 'Atlassian',
    description: 'Search, create, and update Jira issues from Copilot Chat',
    tags: ['project-management', 'jira', 'atlassian', 'official'],
    marketplaceUrl: 'https://github.com/marketplace/jira-copilot-extension',
    category: 'Project Management',
  },
  {
    id: 'github-copilot-confluence',
    name: 'Confluence',
    publisher: 'Atlassian',
    description: 'Search and read Confluence pages as context in Copilot Chat',
    tags: ['docs', 'wiki', 'atlassian', 'official'],
    marketplaceUrl: 'https://github.com/marketplace/confluence-copilot-extension',
    category: 'Documentation',
  },
  {
    id: 'github-copilot-blackbeard',
    name: 'Blackbeard (example)',
    publisher: 'GitHub',
    description: 'Official GitHub example extension — speaks like a pirate. Great for testing.',
    tags: ['example', 'demo', 'github'],
    marketplaceUrl: 'https://github.com/marketplace/blackbeard-copilot-extension',
    category: 'Demo',
  },
  {
    id: 'github-copilot-aws',
    name: 'Amazon Q (AWS)',
    publisher: 'AWS',
    description: 'AWS resource management, CloudFormation, Lambda, and IAM from Copilot',
    tags: ['cloud', 'aws', 'official'],
    marketplaceUrl: 'https://github.com/marketplace/aws-ai-coding-companion',
    category: 'Cloud',
  },
];
