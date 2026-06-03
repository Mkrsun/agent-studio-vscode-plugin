import * as vscode from 'vscode';
import { ConfigService } from './services/configService';
import { AuthService } from './auth/authService';
import { AuthState } from './auth/authTypes';
import { registerSignInViews } from './auth/signInView';
import { registerAuthenticatedSurface } from './auth/authGate';
import { loadDotEnv } from './services/dotenv';
import { COMMANDS, CONFIG_KEYS, CONTEXT_KEYS } from './constants';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Load `.env` (workspace + extension dir) into process.env BEFORE any service
  // reads an AGENT_STUDIO_* override. Real shell/CI env always wins.
  await loadDotEnv(context);

  const configService = new ConfigService();

  // ── Dev-only bypass (no effect in production-installed .vsix) ─────────────
  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  const bypass = configService.get<boolean>(CONFIG_KEYS.AUTH_BYPASS_FOR_DEV) === true;
  if (isDev && bypass) {
    vscode.window.showWarningMessage(
      'Agent Studio: Auth bypassed (DEV MODE). Never ship this configuration.',
    );
    vscode.commands.executeCommand('setContext', CONTEXT_KEYS.AUTHENTICATED, true);
    const disposables = await registerAuthenticatedSurface(context, null, configService);
    context.subscriptions.push(...disposables);
    return;
  }

  // ── Auth service + always-on surface ──────────────────────────────────────
  const authService = new AuthService(context, configService);
  context.subscriptions.push(authService);

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SIGN_IN, () => authService.signIn()),
    vscode.commands.registerCommand(COMMANDS.SIGN_OUT, () => authService.signOut()),
    vscode.commands.registerCommand(COMMANDS.SHOW_AUTH_STATUS, () => authService.showStatus()),
  );

  let phase1Views: vscode.Disposable[] = registerSignInViews(authService);
  let authedDisposables: vscode.Disposable[] = [];

  const reconcile = async (state: AuthState): Promise<void> => {
    if (state === 'authenticated' && authedDisposables.length === 0) {
      phase1Views.forEach((d) => d.dispose());
      phase1Views = [];
      authedDisposables = await registerAuthenticatedSurface(context, authService, configService);
    } else if (state !== 'authenticated' && authedDisposables.length > 0) {
      authedDisposables.forEach((d) => d.dispose());
      authedDisposables = [];
      phase1Views = registerSignInViews(authService);
      if (state === 'denied') {
        const reason = authService.getDenyReason();
        if (reason?.kind === 'sso_required' && reason.ssoUrl) {
          const pick = await vscode.window.showErrorMessage(
            `Agent Studio: your GitHub token needs SAML SSO authorization for ${reason.org}.`,
            'Authorize',
            'Cancel',
          );
          if (pick === 'Authorize') {
            vscode.env.openExternal(vscode.Uri.parse(reason.ssoUrl));
          }
        } else if (reason) {
          vscode.window.showErrorMessage(`Agent Studio sign-in denied: ${reason.message}`);
        }
      }
    }
  };

  context.subscriptions.push(authService.onDidChangeAuthState(reconcile));

  await authService.initialize();
  await reconcile(authService.currentState);

  // Dispose phase1Views on extension deactivation (they won't be in context.subscriptions
  // when they get replaced by auth'd surface, so track lifecycle explicitly)
  context.subscriptions.push({
    dispose: () => {
      phase1Views.forEach((d) => d.dispose());
      authedDisposables.forEach((d) => d.dispose());
    },
  });
}

export function deactivate(): void {
  // Cleanup handled via context.subscriptions
}
