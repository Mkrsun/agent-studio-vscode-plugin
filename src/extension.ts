import * as vscode from 'vscode';
import { ConfigService } from './services/configService';
import { AuthService } from './auth/authService';
import { AuthSurfaceManager } from './auth/authSurfaceManager';
import { registerAuthenticatedSurface } from './auth/authGate';
import { loadDotEnv } from './services/dotenv';
import { initLogger, log, showLogs } from './services/logger';
import { COMMANDS, CONFIG_KEYS, CONTEXT_KEYS } from './constants';

/**
 * Activation reads top-to-bottom as a short sequence of named steps. The two
 * paths — dev bypass and the normal auth-gated surface — are each one call.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogger(context);
  log(`Activating Agent Studio v${readVersion(context)} (mode=${vscode.ExtensionMode[context.extensionMode]})`);
  registerGlobalCommands(context);

  // `.env` must load before any service reads an AGENT_STUDIO_* override.
  await loadDotEnv(context);
  const config = new ConfigService();

  if (isDevAuthBypass(context, config)) {
    await activateWithoutAuth(context, config);
    return;
  }

  const auth = new AuthService(context, config);
  context.subscriptions.push(auth);
  registerAuthCommands(context, auth);

  const surface = new AuthSurfaceManager(context, auth, config);
  context.subscriptions.push(surface);
  await surface.start();
}

export function deactivate(): void {
  // All teardown is registered on context.subscriptions.
}

// ── Activation steps ──────────────────────────────────────────────────────────

function readVersion(context: vscode.ExtensionContext): string {
  return (context.extension?.packageJSON as { version?: string } | undefined)?.version ?? '0.0.0';
}

/** Commands available regardless of auth state. */
function registerGlobalCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(COMMANDS.SHOW_LOGS, showLogs));
}

/** Sign-in / sign-out / status commands (need the AuthService). */
function registerAuthCommands(context: vscode.ExtensionContext, auth: AuthService): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SIGN_IN, () => auth.signIn()),
    vscode.commands.registerCommand(COMMANDS.SIGN_OUT, () => auth.signOut()),
    vscode.commands.registerCommand(COMMANDS.SHOW_AUTH_STATUS, () => auth.showStatus()),
  );
}

/** Dev-only auth bypass: effective ONLY in an Extension Development Host. */
function isDevAuthBypass(context: vscode.ExtensionContext, config: ConfigService): boolean {
  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  return isDev && config.get<boolean>(CONFIG_KEYS.AUTH_BYPASS_FOR_DEV) === true;
}

/** Register the full surface with no auth (dev bypass). */
async function activateWithoutAuth(context: vscode.ExtensionContext, config: ConfigService): Promise<void> {
  vscode.window.showWarningMessage('Agent Studio: Auth bypassed (DEV MODE). Never ship this configuration.');
  vscode.commands.executeCommand('setContext', CONTEXT_KEYS.AUTHENTICATED, true);
  const disposables = await registerAuthenticatedSurface(context, null, config);
  context.subscriptions.push(...disposables);
}
