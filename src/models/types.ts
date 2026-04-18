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

// ─── Inspector: Messages & Tool Invocations ──────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type MessageDirection = 'outbound' | 'inbound';

/** A single message sent to or received from the language model. */
export interface AgentMessage {
  id: string;
  executionId: string;
  stepId?: string;
  agentId?: string;
  role: MessageRole;
  direction: MessageDirection;
  text: string;
  tokenCount?: number;
  timestamp: number;
}

export type ToolKind =
  | 'skill-injection'       // a Skill asset merged into system prompt
  | 'instruction-injection' // an Instruction asset injected
  | 'mcp-call'              // future MCP tool invocation
  | 'hook'                  // Hook trigger fired
  | 'custom';

export interface ToolInvocation {
  id: string;
  executionId: string;
  stepId?: string;
  agentId?: string;
  kind: ToolKind;
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

// ─── Inspector: Unified Event Stream ─────────────────────────────────────────

export type InspectorEventType =
  | 'workflow:started'
  | 'workflow:completed'
  | 'workflow:failed'
  | 'phase:entered'
  | 'step:running'
  | 'step:done'
  | 'step:error'
  | 'step:skipped'
  | 'agent:message'
  | 'tool:invoked'
  | 'tool:completed';

export interface InspectorEvent {
  id: string;
  executionId: string;
  timestamp: number;
  type: InspectorEventType;
  stepId?: string;
  agentId?: string;
  payload?:
    | { kind: 'message'; messageId: string }
    | { kind: 'tool'; toolId: string }
    | { kind: 'step'; status: StepStatus; errorMessage?: string }
    | { kind: 'phase'; phase: WorkflowPhase | string };
}

// ─── Framework preview DTO (for Inspector planned-mode dropdown) ──────────────

export interface FrameworkPreview {
  pluginName: string;
  displayName: string;
  entryAgent?: string;
  subAgents: Array<{ name: string; role: string; phases?: string[] }>;
  phases: Array<{
    name: string;
    label?: string;
    agent?: string;
    skills?: string[];
    outputs?: string[];
  }>;
  strategy?: 'sequential' | 'parallel' | 'conditional';
}

// ─── Execution Tracking ──────────────────────────────────────────────────────

export interface StepExecution {
  stepId: string;
  stepName: string;
  phase: WorkflowPhase;
  status: StepStatus;
  agentId?: string;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  startedAt: number;
  completedAt?: number;
  currentPhase: WorkflowPhase;
  currentStepId?: string;
  steps: StepExecution[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  // ── Inspector additions (all optional — backward-compat) ──────────────
  messages?: AgentMessage[];
  tools?: ToolInvocation[];
  events?: InspectorEvent[];
  playgroundInput?: string;
  playgroundOutput?: string;
}

/** Synthetic execution for an ad-hoc Playground run (not tied to a Workflow asset). */
export interface PlaygroundInvocation extends WorkflowExecution {
  workflowId: 'playground';
  frameworkPluginName?: string;
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
  | { type: 'marketplace:assetState'; assetId: string; installed: boolean; enabled: boolean }
  // ── Inspector ──────────────────────────────────────────────────────────────
  | { type: 'inspector:executionSnapshot'; execution: WorkflowExecution | null }
  | { type: 'inspector:diagramUpdate'; mermaidDsl: string; activeAgentId?: string;
      activeEdgeKey?: string; mode: 'live' | 'planned' }
  | { type: 'inspector:statusPill';
      state: 'idle' | 'connected' | 'running' | 'failed'; detail?: string }
  | { type: 'inspector:playgroundStream'; runId: string; chunk: string }
  | { type: 'inspector:playgroundComplete'; runId: string; ok: boolean; errorMessage?: string }
  | { type: 'inspector:event'; event: InspectorEvent; message?: AgentMessage; tool?: ToolInvocation }
  | { type: 'inspector:init'; installedFrameworks: FrameworkPreview[]; participantAvailable: boolean };

export type WebviewMessage =
  | { type: 'marketplace:ready' }
  | { type: 'marketplace:install'; assetId: string }
  | { type: 'marketplace:uninstall'; assetId: string }
  | { type: 'marketplace:toggle'; assetId: string; enabled: boolean }
  | { type: 'marketplace:filterChange'; query: string; assetType: AssetType | 'all' }
  // ── Inspector ──────────────────────────────────────────────────────────────
  | { type: 'inspector:ready' }
  | { type: 'inspector:requestSnapshot' }
  | { type: 'inspector:selectFramework'; pluginName: string | null }
  | { type: 'inspector:runPlayground'; runId: string; prompt: string;
      target: 'participant' | 'framework' | 'model'; frameworkPluginName?: string }
  | { type: 'inspector:cancelPlayground'; runId: string }
  | { type: 'inspector:runFramework'; pluginName: string; initialInput?: string }
  | { type: 'inspector:copyIoJson' };
