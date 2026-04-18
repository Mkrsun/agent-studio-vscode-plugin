import { DenyReason } from './authTypes';

const BASE = 'https://api.github.com';
const COMMON_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

export interface GitHubUser {
  login: string;
  name: string | null;
  id: number;
}

export interface MembershipResult {
  active: boolean;
  role: string;
}

export class GitHubClient {
  async getUser(token: string): Promise<
    | { ok: true; user: GitHubUser }
    | { ok: false; error: string }
  > {
    try {
      const res = await fetch(`${BASE}/user`, {
        headers: { ...COMMON_HEADERS, Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { ok: false, error: `GET /user failed (${res.status})` };
      const body = (await res.json()) as { login: string; name: string | null; id: number };
      return { ok: true, user: { login: body.login, name: body.name, id: body.id } };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async checkOrgMembership(token: string, org: string): Promise<
    | { ok: true; result: MembershipResult }
    | { ok: false; reason: DenyReason }
  > {
    try {
      const res = await fetch(`${BASE}/user/memberships/orgs/${encodeURIComponent(org)}`, {
        headers: { ...COMMON_HEADERS, Authorization: `Bearer ${token}` },
      });

      if (res.status === 200) {
        const body = (await res.json()) as { state: string; role: string };
        return { ok: true, result: { active: body.state === 'active', role: body.role } };
      }
      if (res.status === 404) {
        // Not a member of this org — not an error; caller decides.
        return { ok: true, result: { active: false, role: '' } };
      }
      if (res.status === 403) {
        const sso = res.headers.get('x-github-sso');
        if (sso && sso.includes('required')) {
          const match = sso.match(/url=([^;,\s]+)/i);
          const ssoUrl = match?.[1];
          return {
            ok: false,
            reason: {
              kind: 'sso_required',
              org,
              ssoUrl,
              message: `GitHub SAML SSO authorization required for "${org}".`,
            },
          };
        }
        return {
          ok: false,
          reason: { kind: 'github_error', message: `Forbidden (403) reading membership for "${org}".` },
        };
      }
      return {
        ok: false,
        reason: { kind: 'github_error', message: `GitHub returned ${res.status} for "${org}".` },
      };
    } catch (e) {
      return { ok: false, reason: { kind: 'network', message: (e as Error).message } };
    }
  }
}
