export const PARTICIPANT_ID = 'agent-studio.assistant';
export const EXTENSION_ID = 'agent-studio';

export const ASSET_TYPES = ['skill', 'agent', 'workflow', 'instruction', 'hook'] as const;

export const WORKSPACE_FOLDER = '.agent-studio';

export const COMMANDS = {
  OPEN_MARKETPLACE: 'agentStudio.openMarketplace',
  REFRESH_INSPECTOR: 'agentStudio.refreshInspector',
  ENABLE_ASSET: 'agentStudio.enableAsset',
  DISABLE_ASSET: 'agentStudio.disableAsset',
  INJECT_ASSET: 'agentStudio.injectAsset',
  PREVIEW_ASSET: 'agentStudio.previewAsset',
  INSTALL_ASSET: 'agentStudio.installAsset',
  UNINSTALL_ASSET: 'agentStudio.uninstallAsset',
  EXPORT_TO_COPILOT: 'agentStudio.exportToCopilot',
  SUBMIT_USAGE: 'agentStudio.submitUsage',
  INSTALL_PLUGIN: 'agentStudio.installPlugin',
  UNINSTALL_PLUGIN: 'agentStudio.uninstallPlugin',
  SIGN_IN: 'agentStudio.signIn',
  SIGN_OUT: 'agentStudio.signOut',
  SHOW_AUTH_STATUS: 'agentStudio.showAuthStatus',
  SHOW_LOGS: 'agentStudio.showLogs',
} as const;

export const CONTEXT_KEYS = {
  AUTHENTICATED: 'agentStudio.authenticated',
  UPDATING: 'agentStudio.updating',
} as const;

export const VIEW_IDS = {
  INSPECTOR: 'agentStudio.inspector',
} as const;

export const CONFIG_KEYS = {
  MARKETPLACES: 'agentStudio.marketplaces',
  WORKSPACE_ASSETS_FOLDER: 'agentStudio.workspaceAssetsFolder',
  ENABLED_ASSETS: 'agentStudio.enabledAssets',
  DISABLED_ASSETS: 'agentStudio.disabledAssets',
  AUTO_INJECT: 'agentStudio.autoInjectEnabledAssets',
  DEFAULT_WORKFLOW: 'agentStudio.defaultWorkflow',
  MAX_CONTEXT_ASSETS: 'agentStudio.maxContextAssets',
  AUTH_REQUIRED_GITHUB_ORGS: 'agentStudio.auth.requiredGitHubOrgs',
  AUTH_BYPASS_FOR_DEV: 'agentStudio.auth.bypassForDev',
  AUTH_REQUIRE_ORG: 'agentStudio.auth.requireOrgMembership',
  EXTENSION_AUTO_UPDATE: 'agentStudio.extensionAutoUpdate',
  EXTENSION_UPDATE_REPO: 'agentStudio.extensionUpdateRepo',
  EXTENSION_UPDATE_MANIFEST: 'agentStudio.extensionUpdateManifestPath',
  ANALYTICS_REPO: 'agentStudio.analyticsRepo',
  ANALYTICS_ENABLED: 'agentStudio.analytics.enabled',
  ANALYTICS_AUTO_SUBMIT: 'agentStudio.analytics.autoSubmit',
  ANALYTICS_AUTO_OTEL: 'agentStudio.analytics.autoEnableCopilotOtel',
  ASSET_AUTO_UPDATE: 'agentStudio.assetAutoUpdate',
} as const;

// Environment-variable overrides (env wins over settings → easy CI/ops pointing
// without touching VS Code settings.json).
export const ENV = {
  UPDATE_REPO: 'AGENT_STUDIO_UPDATE_REPO',        // owner/repo for the extension's own VSIX releases
  MARKETPLACE_REPO: 'AGENT_STUDIO_MARKETPLACE_REPO', // owner/repo of a content marketplace (quick single override)
  MARKETPLACES: 'AGENT_STUDIO_MARKETPLACES',      // full multi-marketplace list: "id:Label:owner/repo, …" or JSON array
  ANALYTICS_REPO: 'AGENT_STUDIO_ANALYTICS_REPO',  // owner/repo of the analytics datastore
  REQUIRED_ORGS: 'AGENT_STUDIO_REQUIRED_ORGS',    // comma-separated GitHub orgs that grant access (org-gating)
} as const;

export const DEFAULT_UPDATE_REPO = 'Mkrsun/agent-studio-vscode-plugin';

export const ASSET_TYPE_LABELS: Record<string, string> = {
  skill: 'Skills',
  agent: 'Agents',
  workflow: 'Workflows',
  instruction: 'Instructions',
  hook: 'Hooks',
  plugin: 'Plugins',
  'mcp-server': 'MCP Servers',
};

export const ASSET_TYPE_ICONS: Record<string, string> = {
  skill: 'tools',
  agent: 'robot',
  workflow: 'git-branch',
  instruction: 'book',
  hook: 'zap',
  plugin: 'package',
  'mcp-server': 'plug',
};
