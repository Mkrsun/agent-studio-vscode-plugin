import * as vscode from 'vscode';
import { DevIdentity } from './identity';
import { log, error as logError } from '../services/logger';

export const METRICS_SCHEMA = 'agent-studio/v1';

/** A token-usage row from an Agent Studio chat-participant LM call. */
export interface UsageEvent {
  kind: 'usage';
  model: string;
  assetId?: string;
  assetType?: string;
  command?: string;       // /skill, /agent, /discover, …
  languageId?: string;    // active editor language at invocation
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

/** An asset lifecycle event → powers popularity / most-installed metrics. */
export interface AssetEvent {
  kind: 'asset';
  event: 'install' | 'uninstall' | 'update' | 'invoke';
  assetId: string;
  assetType: string;
  marketplace?: string;
}

/** A TRUE Copilot token row imported from Copilot's OpenTelemetry export. */
export interface CopilotEvent {
  kind: 'copilot';
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** ISO timestamp from the OTel span (kept as-is, not "now"). */
  ts: string;
}

export type MetricEvent = UsageEvent | AssetEvent;

/**
 * Appends numbers-only metric rows to a per-dev NDJSON file in the extension's
 * global storage (workspace-independent, so collection works everywhere). The
 * file is later PR'd to the analytics repo verbatim.
 *
 * PRIVACY: rows are keyed by the anonymous `devId` only — never a name, login,
 * or email — and carry counts + coarse tags (asset id, model, language,
 * country). NEVER prompt/response content. Insights, not tracking.
 */
export class MetricsCollector {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly identity: DevIdentity,
  ) {}

  recordUsage(e: Omit<UsageEvent, 'kind'>): Promise<void> {
    return this.append({ kind: 'usage', ...e });
  }

  recordAsset(e: Omit<AssetEvent, 'kind'>): Promise<void> {
    return this.append({ kind: 'asset', ...e });
  }

  /** Record a Copilot OTel row, preserving its own timestamp/date. */
  recordCopilot(e: Omit<CopilotEvent, 'kind'>): Promise<void> {
    return this.appendRow({
      kind: 'copilot',
      model: e.model,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      ts: e.ts,
      date: e.ts.slice(0, 10),
    });
  }

  /** The per-dev NDJSON file for the current month, e.g. perf/<devId>/2026-06.ndjson. */
  fileUri(): vscode.Uri {
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'perf', this.identity.devId, `${month}.ndjson`);
  }

  /** Directory holding all of this dev's monthly files (what auto-submit uploads). */
  devDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'perf', this.identity.devId);
  }

  /** Stamp an event with "now" + identity, then persist. */
  private append(event: MetricEvent): Promise<void> {
    const now = new Date().toISOString();
    return this.appendRow({ ...event, ts: now, date: now.slice(0, 10) });
  }

  /** Persist a row that already carries its own ts/date (e.g. imported Copilot rows). */
  private async appendRow(partial: Record<string, unknown>): Promise<void> {
    const row = {
      schema: METRICS_SCHEMA,
      devId: this.identity.devId,
      country: this.identity.country,
      locale: this.identity.locale,
      tz: this.identity.timezone,
      ...partial,
    };
    const line = JSON.stringify(row) + '\n';
    try {
      const uri = this.fileUri();
      await vscode.workspace.fs.createDirectory(this.devDir());
      const existing = await this.readIfPresent(uri);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(existing + line, 'utf8'));
    } catch (e) {
      logError('Failed to record metric', e, 'analytics');
    }
  }

  private async readIfPresent(uri: vscode.Uri): Promise<string> {
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      return '';
    }
  }
}

/** Count tokens for the prompt; falls back to a chars/4 estimate if the model can't. */
export async function countTokensSafe(model: vscode.LanguageModelChat, text: string): Promise<number> {
  try {
    return await model.countTokens(text);
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export function logUsageDebug(e: Omit<UsageEvent, 'kind'>): void {
  log(`usage model=${e.model} asset=${e.assetId ?? '-'} in=${e.inputTokens} out=${e.outputTokens} ${e.durationMs}ms`, 'analytics');
}
