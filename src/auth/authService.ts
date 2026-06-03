import * as vscode from 'vscode';
import { ConfigService } from '../services/configService';
import { CONFIG_KEYS, CONTEXT_KEYS } from '../constants';
import { GitHubClient } from './githubClient';
import {
  AuthResult,
  AuthState,
  CachedSession,
  DenyReason,
  SessionInfo,
} from './authTypes';

const SECRET_KEY_SESSION = 'agentStudio.auth.session.v1';
const GITHUB_PROVIDER = 'github';
// `repo` is required to read PRIVATE marketplace/content repos + download private VSIX
// release assets for self-update. `read:org` is only requested when org-gating is enabled.
const BASE_SCOPES = ['repo', 'user:email'];

export class AuthService implements vscode.Disposable {
  private _state: AuthState = 'unauthenticated';
  private _session: SessionInfo | null = null;
  private _denyReason: DenyReason | null = null;
  private readonly _emitter = new vscode.EventEmitter<AuthState>();
  private readonly _github: GitHubClient;
  private readonly _subs: vscode.Disposable[] = [];
  private readonly _output: vscode.OutputChannel;

  readonly onDidChangeAuthState = this._emitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly config: ConfigService,
    github: GitHubClient = new GitHubClient(),
  ) {
    this._github = github;
    this._output = vscode.window.createOutputChannel('Agent Studio Auth');
  }

  get currentState(): AuthState {
    return this._state;
  }
  isAuthenticated(): boolean {
    return this._state === 'authenticated';
  }
  getSessionInfo(): SessionInfo | null {
    return this._session;
  }
  getDenyReason(): DenyReason | null {
    return this._denyReason;
  }

  /** Called once during activate(). Silent SSO + re-validation. Fail-closed. */
  async initialize(): Promise<void> {
    this._subs.push(
      vscode.authentication.onDidChangeSessions((e) => {
        if (e.provider.id === GITHUB_PROVIDER) this._onSessionsChanged();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('agentStudio.auth')) this._onAuthConfigChanged();
      }),
    );

    if (this.config.requireOrgMembership() && this._requiredOrgs().length === 0) {
      this._denyReason = {
        kind: 'misconfigured',
        message:
          'Org gating is enabled (agentStudio.auth.requireOrgMembership) but no orgs are configured (agentStudio.auth.requiredGitHubOrgs).',
      };
      this._transition('denied');
      return;
    }

    const cached = await this._readCache();
    const session = await this._getSession({ silent: true, accountHint: cached?.accountId });
    if (!session) {
      await this._clearCache();
      this._transition('unauthenticated');
      return;
    }

    await this._validateAndApply(session);
  }

  async signIn(): Promise<AuthResult> {
    this._denyReason = null;
    this._transition('authenticating');

    if (this.config.requireOrgMembership() && this._requiredOrgs().length === 0) {
      const reason: DenyReason = {
        kind: 'misconfigured',
        message:
          'Org gating is enabled (agentStudio.auth.requireOrgMembership) but no orgs are configured (agentStudio.auth.requiredGitHubOrgs).',
      };
      this._denyReason = reason;
      this._transition('denied');
      return { ok: false, reason };
    }

    let session: vscode.AuthenticationSession | null;
    try {
      session = await this._getSession({ createIfNone: true });
    } catch (e) {
      const reason: DenyReason = {
        kind: 'signin_failed',
        message: (e as Error).message ?? 'GitHub sign-in failed.',
      };
      this._denyReason = reason;
      this._transition('unauthenticated');
      return { ok: false, reason };
    }
    if (!session) {
      const reason: DenyReason = {
        kind: 'signin_failed',
        message: 'No GitHub session was returned by VS Code.',
      };
      this._denyReason = reason;
      this._transition('unauthenticated');
      return { ok: false, reason };
    }

    return this._validateAndApply(session);
  }

  async signOut(): Promise<void> {
    await this._clearCache();
    this._session = null;
    this._denyReason = null;
    this._transition('unauthenticated');
  }

  /**
   * Returns a fresh GitHub access token for use by the marketplace client.
   * Uses silent=true so it never prompts. Returns null if not authenticated.
   */
  async getAccessToken(): Promise<string | null> {
    const session = await this._getSession({ silent: true });
    return session?.accessToken ?? null;
  }

  async showStatus(): Promise<void> {
    const s = this._session;
    if (s) {
      await vscode.window.showInformationMessage(
        `Agent Studio: signed in as ${s.displayName} (${s.login}). Orgs: ${s.matchedOrgs.join(', ')}.`,
      );
    } else if (this._denyReason) {
      await vscode.window.showWarningMessage(
        `Agent Studio: not authenticated — ${this._denyReason.message}`,
      );
    } else {
      await vscode.window.showInformationMessage('Agent Studio: not signed in.');
    }
  }

  dispose(): void {
    this._subs.forEach((d) => d.dispose());
    this._emitter.dispose();
    this._output.dispose();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _requiredOrgs(): string[] {
    return this.config.getRequiredOrgs();
  }

  private async _getSession(opts: {
    silent?: boolean;
    createIfNone?: boolean;
    accountHint?: string;
  }): Promise<vscode.AuthenticationSession | null> {
    const options: vscode.AuthenticationGetSessionOptions = {};
    if (opts.silent) options.silent = true;
    if (opts.createIfNone) options.createIfNone = true;
    if (opts.accountHint) {
      options.account = { id: opts.accountHint, label: opts.accountHint };
    }
    const scopes = this.config.requireOrgMembership()
      ? [...BASE_SCOPES, 'read:org']
      : BASE_SCOPES;
    const session = await vscode.authentication.getSession(GITHUB_PROVIDER, scopes, options);
    return session ?? null;
  }

  private async _validate(session: vscode.AuthenticationSession): Promise<
    | { ok: true; session: SessionInfo }
    | { ok: false; reason: DenyReason }
  > {
    const me = await this._github.getUser(session.accessToken);
    if (!me.ok) {
      return { ok: false, reason: { kind: 'github_error', message: me.error } };
    }
    const login = me.user.login;
    const displayName = me.user.name ?? me.user.login;

    // Feature flag OFF (default): any authenticated GitHub user passes — no org gating.
    if (!this.config.requireOrgMembership()) {
      return { ok: true, session: { login, displayName, matchedOrgs: [] } };
    }

    const orgs = this._requiredOrgs();
    const checks = await Promise.all(
      orgs.map((org) => this._github.checkOrgMembership(session.accessToken, org)),
    );
    const matched: string[] = [];
    for (let i = 0; i < checks.length; i++) {
      const res = checks[i];
      if (!res.ok) return { ok: false, reason: res.reason };
      if (res.result.active) matched.push(orgs[i]);
    }

    if (matched.length === 0) {
      return {
        ok: false,
        reason: {
          kind: 'org_denied',
          message: `Active membership required in one of: ${orgs.join(', ')}.`,
        },
      };
    }

    return { ok: true, session: { login, displayName, matchedOrgs: matched } };
  }

  private _applyOk(info: SessionInfo): void {
    this._session = info;
    this._denyReason = null;
    this._transition('authenticated');
  }

  /** Shared tail for initialize / signIn / session-change: validate, persist, transition. */
  private async _validateAndApply(session: vscode.AuthenticationSession): Promise<AuthResult> {
    const result = await this._validate(session);
    if (!result.ok) {
      await this._clearCache();
      this._denyReason = result.reason;
      this._transition('denied');
      return { ok: false, reason: result.reason };
    }
    await this._persist(session, result.session);
    this._applyOk(result.session);
    return { ok: true, session: result.session };
  }

  private _transition(next: AuthState): void {
    if (this._state === next) return;
    this._log(`state: ${this._state} → ${next}`);
    this._state = next;
    vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.AUTHENTICATED,
      next === 'authenticated',
    );
    this._emitter.fire(next);
  }

  private async _readCache(): Promise<CachedSession | null> {
    const raw = await this.context.secrets.get(SECRET_KEY_SESSION);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedSession;
    } catch {
      return null;
    }
  }

  private async _persist(
    session: vscode.AuthenticationSession,
    info: SessionInfo,
  ): Promise<void> {
    const cached: CachedSession = {
      accountId: session.account.id,
      login: info.login,
      displayName: info.displayName,
      matchedOrgs: info.matchedOrgs,
      validatedAt: Date.now(),
    };
    await this.context.secrets.store(SECRET_KEY_SESSION, JSON.stringify(cached));
  }

  private async _clearCache(): Promise<void> {
    await this.context.secrets.delete(SECRET_KEY_SESSION);
  }

  private _log(msg: string): void {
    this._output.appendLine(`[${new Date().toISOString()}] ${msg}`);
  }

  private async _onSessionsChanged(): Promise<void> {
    if (!this.isAuthenticated()) return;
    this._log('GitHub sessions changed — re-validating.');
    const session = await this._getSession({ silent: true });
    if (!session) {
      await this.signOut();
      return;
    }
    await this._validateAndApply(session);
  }

  private async _onAuthConfigChanged(): Promise<void> {
    this._log('auth config changed — forcing sign-out to re-validate.');
    await this.signOut();
  }
}
