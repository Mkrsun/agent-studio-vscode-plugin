import { log } from '../services/logger';

const ENV_DEBUG = 'AGENT_STUDIO_TELEMETRY_DEBUG';
let enabled = Boolean(process.env[ENV_DEBUG]);

export function isTelemetryDebugEnabled(): boolean {
  return enabled;
}

export function setTelemetryDebugEnabled(value: boolean): void {
  enabled = value;
  log(`Telemetry debug ${enabled ? 'enabled' : 'disabled'}`, 'analytics');
}

export function logMetricEvent(event: Record<string, unknown>, source: string): void {
  if (!enabled) return;
  const payload = {
    source,
    ts: new Date().toISOString(),
    ...event,
  };
  log(`METRIC EVENT ${JSON.stringify(payload)}`, 'analytics');
}
