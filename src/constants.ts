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
  INSTALL_PLUGIN: 'agentStudio.installPlugin',
  UNINSTALL_PLUGIN: 'agentStudio.uninstallPlugin',
  SIGN_IN: 'agentStudio.signIn',
  SIGN_OUT: 'agentStudio.signOut',
  SHOW_AUTH_STATUS: 'agentStudio.showAuthStatus',
} as const;

export const CONTEXT_KEYS = {
  AUTHENTICATED: 'agentStudio.authenticated',
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
} as const;

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
