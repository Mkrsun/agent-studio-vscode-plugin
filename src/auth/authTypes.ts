export type AuthState = 'unauthenticated' | 'authenticating' | 'authenticated' | 'denied';

export interface SessionInfo {
  login: string;
  displayName: string;
  matchedOrgs: string[];
}

export type DenyReason =
  | { kind: 'misconfigured'; message: string }
  | { kind: 'org_denied'; message: string }
  | { kind: 'sso_required'; org: string; ssoUrl?: string; message: string }
  | { kind: 'github_error'; message: string }
  | { kind: 'signin_failed'; message: string }
  | { kind: 'network'; message: string };

export type AuthResult =
  | { ok: true; session: SessionInfo }
  | { ok: false; reason: DenyReason };

export interface CachedSession {
  accountId: string;
  login: string;
  displayName: string;
  matchedOrgs: string[];
  validatedAt: number;
}
