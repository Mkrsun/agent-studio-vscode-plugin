import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';

/**
 * Anonymous developer identity attached to every metric. Deliberately carries
 * NO name, GitHub login, email, or any PII — only a random pseudonymous id and
 * coarse locale/country so we get *insights*, not *tracking*.
 *
 * `devId` is a random UUID generated once per install and stored in globalState.
 * It lets us group a developer's own activity (per-dev insights) without ever
 * knowing who they are; it cannot be reversed to an identity.
 */
export interface DevIdentity {
  devId: string;
  /** Best-effort ISO-3166 alpha-2 country, derived locally from the IDE timezone. '' if unknown. */
  country: string;
  locale: string;
  timezone: string;
}

const DEV_ID_KEY = 'agentStudio.analytics.devId';

/** Resolve (and persist) the anonymous identity. No network, no GitHub call. */
export async function resolveIdentity(context: vscode.ExtensionContext): Promise<DevIdentity> {
  const locale = vscode.env.language || 'en';
  const timezone = currentTimezone();
  const country = countryFromTimezone(timezone) || countryFromLocale(locale);
  return { devId: await resolveDevId(context), country, locale, timezone };
}

async function resolveDevId(context: vscode.ExtensionContext): Promise<string> {
  const existing = context.globalState.get<string>(DEV_ID_KEY);
  if (existing) return existing;
  const id = randomUUID();
  await context.globalState.update(DEV_ID_KEY, id);
  return id;
}

function currentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/**
 * Map a handful of common IANA timezones to a country. Intentionally small and
 * explicit (no dependency); the raw `timezone` travels with each row so the
 * analytics side can extend the mapping without an extension release.
 */
const TZ_COUNTRY: Record<string, string> = {
  'America/Santiago': 'CL',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Sao_Paulo': 'BR',
  'America/Mexico_City': 'MX',
  'America/Bogota': 'CO',
  'America/Lima': 'PE',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Los_Angeles': 'US',
  'Europe/Madrid': 'ES',
  'Europe/London': 'GB',
  'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR',
  'Asia/Kolkata': 'IN',
  'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN',
};

function countryFromTimezone(tz: string): string {
  return TZ_COUNTRY[tz] ?? '';
}

/** Last resort: a region suffix in the locale, e.g. "es-CL" → "CL". */
function countryFromLocale(locale: string): string {
  const m = /[-_]([A-Za-z]{2})$/.exec(locale);
  return m ? m[1].toUpperCase() : '';
}
