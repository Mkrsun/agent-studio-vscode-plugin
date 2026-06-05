import * as vscode from 'vscode';
import { ConfigService } from '../services/configService';
import { AuthService } from './authService';
import { AuthState, DenyReason } from './authTypes';
import { registerSignInViews } from './signInView';
import { registerAuthenticatedSurface } from './authGate';

/**
 * Owns the swap between the unauthenticated sign-in views and the full
 * authenticated surface as the GitHub session comes and goes.
 *
 * The two disposable sets live as fields (not closure variables), so the
 * reconcile logic is a set of small, named methods instead of one nested
 * closure — easier to read, reason about, and test.
 */
export class AuthSurfaceManager implements vscode.Disposable {
  private _signInViews: vscode.Disposable[] = [];
  private _authedSurface: vscode.Disposable[] = [];
  private _stateSubscription: vscode.Disposable | undefined;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _auth: AuthService,
    private readonly _config: ConfigService,
  ) {}

  /** Show the sign-in surface, then react to auth-state changes for the session. */
  async start(): Promise<void> {
    this._signInViews = registerSignInViews(this._auth);
    this._stateSubscription = this._auth.onDidChangeAuthState((state) => this._reconcile(state));
    await this._auth.initialize();
    await this._reconcile(this._auth.currentState);
  }

  dispose(): void {
    this._stateSubscription?.dispose();
    this._disposeAll(this._signInViews);
    this._disposeAll(this._authedSurface);
  }

  /** Bring the visible surface in line with the current auth state. */
  private async _reconcile(state: AuthState): Promise<void> {
    const authenticated = state === 'authenticated';
    if (authenticated && this._authedSurface.length === 0) {
      await this._showAuthenticatedSurface();
    } else if (!authenticated && this._authedSurface.length > 0) {
      this._showSignInSurface();
      if (state === 'denied') await this._reportDenial(this._auth.getDenyReason());
    }
  }

  private async _showAuthenticatedSurface(): Promise<void> {
    this._disposeAll(this._signInViews);
    this._signInViews = [];
    this._authedSurface = await registerAuthenticatedSurface(this._context, this._auth, this._config);
  }

  private _showSignInSurface(): void {
    this._disposeAll(this._authedSurface);
    this._authedSurface = [];
    this._signInViews = registerSignInViews(this._auth);
  }

  /** Surface a denial as a toast, with an SSO-authorize action when applicable. */
  private async _reportDenial(reason: DenyReason | null): Promise<void> {
    if (!reason) return;

    if (reason.kind === 'sso_required' && reason.ssoUrl) {
      const pick = await vscode.window.showErrorMessage(
        `Agent Studio: your GitHub token needs SAML SSO authorization for ${reason.org}.`,
        'Authorize',
        'Cancel',
      );
      if (pick === 'Authorize') vscode.env.openExternal(vscode.Uri.parse(reason.ssoUrl));
      return;
    }

    vscode.window.showErrorMessage(`Agent Studio sign-in denied: ${reason.message}`);
  }

  private _disposeAll(items: vscode.Disposable[]): void {
    items.forEach((d) => d.dispose());
  }
}
