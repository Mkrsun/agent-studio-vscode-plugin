// ─── Asset Core Types ────────────────────────────────────────────────────────

export type AssetType = 'skill' | 'agent' | 'workflow' | 'instruction' | 'hook';
export type AssetSource = 'bundled' | 'workspace' | 'remote';
/** ID of the marketplace this asset was fetched from (e.g. "chile", "regional"). */
export type MarketplaceId = string;
export type AssetEnabled = 'enabled' | 'disabled';
export type WorkflowPhase = 'discovery' | 'planning' | 'implementation' | 'review' | 'custom';
export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

// ─── Asset Base ───────────────────────────────────────────────────────────────

export interface AssetBase {
  id: string;
  name: string;
  type: AssetType;
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  icon?: string;
  source: AssetSource;
  enabled: AssetEnabled;
  /** Set for remote assets; identifies which marketplace they came from. */
  marketplaceId?: MarketplaceId;
}

// ─── Skill ───────────────────────────────────────────────────────────────────

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
}

export interface Skill extends AssetBase {
  type: 'skill';
  systemPrompt: string;
  userPromptTemplate?: string;
  parameters?: SkillParameter[];
  bestPractices?: string[];
  examples?: Array<{ input: string; output: string }>;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export interface AgentCapability {
  name: string;
  description: string;
  skillIds: string[];
}

export interface Agent extends AssetBase {
  type: 'agent';
  role: string;
  systemPrompt: string;
  capabilities: AgentCapability[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  name: string;
  phase: WorkflowPhase;
  agentId?: string;
  skillIds?: string[];
  instructionIds?: string[];
  prompt: string;
  dependsOn?: string[];
  optional?: boolean;
}

export interface Workflow extends AssetBase {
  type: 'workflow';
  phases: WorkflowPhase[];
  steps: WorkflowStep[];
  triggerPhrases?: string[];
  entryPhase: WorkflowPhase;
}

// ─── Instruction ─────────────────────────────────────────────────────────────

export interface Instruction extends AssetBase {
  type: 'instruction';
  scope: 'global' | 'file' | 'language';
  languageIds?: string[];
  content: string;
  priority: number;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export type HookTrigger =
  | 'pre-request'
  | 'post-response'
  | 'pre-commit'
  | 'post-generation'
  | 'workflow-start'
  | 'workflow-end'
  | 'step-start'
  | 'step-end';

export interface Hook extends AssetBase {
  type: 'hook';
  trigger: HookTrigger;
  condition?: string;
  action: 'inject-prompt' | 'transform-response' | 'notify' | 'run-command';
  payload: string;
  workflowIds?: string[];
}

// ─── Union & Manifest ─────────────────────────────────────────────────────────

export type Asset = Skill | Agent | Workflow | Instruction | Hook;

export interface AssetManifest {
  schemaVersion: '1.0';
  asset: Asset;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export interface RegistryAssetEntry {
  id: string;
  type: AssetType;
  name: string;
  version: string;
  description: string;
  downloadUrl: string;
  tags: string[];
  source: AssetSource;
  enabled: AssetEnabled;
}

export interface AssetRegistryIndex {
  version: string;
  updatedAt: string;
  assets: RegistryAssetEntry[];
}

// ─── Webview Messages ─────────────────────────────────────────────────────────

export type HostMessage =
  | { type: 'marketplace:loadCatalog'; assets: RegistryAssetEntry[] }
  | { type: 'marketplace:installResult'; assetId: string; success: boolean; error?: string }
  | { type: 'marketplace:assetState'; assetId: string; installed: boolean; enabled: boolean };

export type WebviewMessage =
  | { type: 'marketplace:ready' }
  | { type: 'marketplace:install'; assetId: string }
  | { type: 'marketplace:uninstall'; assetId: string }
  | { type: 'marketplace:toggle'; assetId: string; enabled: boolean }
  | { type: 'marketplace:filterChange'; query: string; assetType: AssetType | 'all' };
