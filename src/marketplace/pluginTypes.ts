/**
 * GitHub Copilot CLI Plugin system types — extended for agentic frameworks.
 *
 * A plugin can be:
 *  - A simple agent pack / skill pack
 *  - A full agentic framework: orchestrator + sub-agents + phases + docs
 *
 * Reference: https://docs.github.com/en/copilot/using-github-copilot/using-copilot-cli
 */

// ── Plugin classification ─────────────────────────────────────────────────

/**
 * Describes the nature of the plugin:
 *  - `plugin`      → generic bundle (default)
 *  - `framework`   → complete agentic way-of-working with phases, orchestration, docs
 *  - `agent-pack`  → one or more standalone agents
 *  - `skill-pack`  → reusable skills (no agent persona)
 *  - `toolkit`     → MCP + LSP + tooling, no AI agents
 */
export type PluginType = 'plugin' | 'framework' | 'agent-pack' | 'skill-pack' | 'toolkit';

// ── Framework-specific types ──────────────────────────────────────────────

export interface PluginPhase {
  /** Phase identifier, e.g. "discovery" */
  name: string;
  /** Human-readable label, e.g. "Discovery & Requirements" */
  label?: string;
  description: string;
  /** Which agent (by name) is responsible for this phase */
  agent?: string;
  /** Skills used in this phase */
  skills?: string[];
  /** Documents / artifacts produced in this phase */
  outputs?: string[];
  /** Whether user confirmation is required before moving to next phase */
  requiresConfirmation?: boolean;
}

export interface OrchestrationConfig {
  /** Name of the top-level orchestrator agent */
  entryAgent: string;
  /** Sub-agents managed by the orchestrator */
  subAgents?: Array<{
    name: string;
    role: string;
    /** Which phases this sub-agent handles */
    phases?: string[];
  }>;
  /** How the orchestrator delegates work */
  strategy?: 'sequential' | 'parallel' | 'conditional';
}

/** Document / artifact types a framework can generate */
export type GeneratedDoc =
  | 'sdd'         // System Design Document
  | 'tdd'         // Technical Design Document / Test-Driven Development spec
  | 'adr'         // Architecture Decision Record
  | 'api-docs'    // API documentation
  | 'changelog'   // Changelog entry
  | 'test-plan'   // Test plan
  | 'runbook'     // Operational runbook
  | 'readme'      // README / documentation
  | 'user-story'; // User story / requirements doc

// ── plugin.json manifest ─────────────────────────────────────────────────

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface PluginManifest {
  name: string;
  description: string;
  version: string;
  author?: PluginAuthor | string;
  license?: string;
  keywords?: string[];
  homepage?: string;
  repository?: string;

  // ── Classification ──────────────────────────────────────────────────────
  /**
   * What kind of plugin this is.
   * `framework` means it ships a complete agentic way-of-working.
   */
  type?: PluginType;

  // ── File paths ──────────────────────────────────────────────────────────
  /** Path to agents directory (contains *.agent.md files) */
  agents?: string;
  /** Path(s) to skills directories */
  skills?: string | string[];
  /** Path to hooks.json or hooks/ directory */
  hooks?: string;
  /** Path to .mcp.json with MCP server configurations */
  mcpServers?: string;
  /** Path to lsp.json with LSP server configurations */
  lspServers?: string;
  /** Path to instructions/ directory with *.instructions.md files */
  instructions?: string;
  /** Path to workflows/ directory with workflow definitions */
  workflows?: string;

  // ── Framework-specific ──────────────────────────────────────────────────
  /**
   * Ordered phases of this framework.
   * Each phase is handled by an agent and produces specific outputs.
   */
  phases?: PluginPhase[];

  /** How agents are orchestrated within this framework */
  orchestration?: OrchestrationConfig;

  /**
   * Document types this framework generates as part of its workflow.
   * e.g. ["sdd", "tdd", "adr"] for a full-stack feature framework.
   */
  generates?: GeneratedDoc[];

  /**
   * Domain areas this framework is designed for.
   * e.g. ["migration", "database", "cloud"] for a migration framework.
   */
  domains?: string[];

  /**
   * Short "elevator pitch" for what working with this framework looks like.
   * Shown prominently in the marketplace card.
   */
  wayOfWorking?: string;
}

// ── marketplace.json ─────────────────────────────────────────────────────

export interface MarketplacePluginEntry {
  name: string;
  description: string;
  version: string;
  /** Path relative to the marketplace repo root */
  source: string;
  author?: string;
  keywords?: string[];
  homepage?: string;
  license?: string;

  // Classification & preview info (from plugin.json, pre-indexed here for display)
  type?: PluginType;
  /** Component types bundled */
  components?: Array<'agents' | 'skills' | 'hooks' | 'mcp' | 'lsp' | 'instructions' | 'workflows'>;
  /** Phase names in order (for framework plugins) */
  phases?: string[];
  /** Document types generated */
  generates?: GeneratedDoc[];
  /** Domain tags */
  domains?: string[];
  /** Agent count info */
  agentCount?: { orchestrators: number; specialists: number };
  /** One-liner describing the way of working */
  wayOfWorking?: string;
}

export interface MarketplaceIndex {
  name: string;
  owner?: { name: string; email?: string };
  metadata?: { description: string; version: string };
  plugins: MarketplacePluginEntry[];
}

// ── Marketplace registry ──────────────────────────────────────────────────

export interface MarketplaceSource {
  id: string;
  label: string;
  owner: string;
  repo: string;
  branch?: string;
  indexPath?: string;
}

export const DEFAULT_MARKETPLACES: MarketplaceSource[] = [
  {
    id: 'copilot-plugins',
    label: 'GitHub Copilot Plugins',
    owner: 'github',
    repo: 'copilot-plugins',
  },
  {
    id: 'awesome-copilot',
    label: 'Awesome Copilot',
    owner: 'github',
    repo: 'awesome-copilot',
  },
];

// ── Installed plugin state ────────────────────────────────────────────────

export interface InstalledPluginRecord {
  name: string;
  description: string;
  version: string;
  type: PluginType;
  marketplaceId: string;
  installedAt: string;
  marketplaceRepo: string;
  source: string;
  components: Array<'agents' | 'skills' | 'hooks' | 'mcp' | 'lsp' | 'instructions' | 'workflows'>;
  phases?: string[];
  generates?: GeneratedDoc[];
  domains?: string[];
  agentCount?: { orchestrators: number; specialists: number };
}

// ── Display helpers ───────────────────────────────────────────────────────

export const PLUGIN_TYPE_LABELS: Record<PluginType, string> = {
  plugin:      'Plugin',
  framework:   'Framework',
  'agent-pack': 'Agent Pack',
  'skill-pack': 'Skill Pack',
  toolkit:     'Toolkit',
};

export const DOC_LABELS: Record<GeneratedDoc, string> = {
  sdd:         'SDD',
  tdd:         'TDD',
  adr:         'ADR',
  'api-docs':  'API Docs',
  changelog:   'Changelog',
  'test-plan': 'Test Plan',
  runbook:     'Runbook',
  readme:      'README',
  'user-story': 'User Story',
};
