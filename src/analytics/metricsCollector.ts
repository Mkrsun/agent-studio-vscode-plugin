import * as vscode from 'vscode';
import { DevIdentity } from './identity';
import { log, error as logError } from '../services/logger';
import { logMetricEvent, isTelemetryDebugEnabled } from './eventDebug';

export const METRICS_SCHEMA = 'agent-studio/v1';
const FLUSH_DEBOUNCE_MS = 1500; // coalesce a burst of events (e.g. an OTel import) into one write
const SEP = '';

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
 * Collects numbers-only metrics into a per-dev monthly NDJSON file, AGGREGATED at the source.
 *
 * Token rows (Copilot OTel imports + Agent Studio LM calls) are rolled up in memory by
 * (date × model × country × language × asset) — summing tokens and counting `requests` — so a
 * firehose of thousands of per-event OTel spans collapses to a handful of rows. Asset lifecycle
 * events (install/invoke/…) stay individual (low volume; counted per-row downstream). The map is
 * flushed to disk debounced (and on demand via flushNow), so we write once per burst instead of
 * re-reading + rewriting the whole file on every event. The file is later PR'd verbatim and the
 * insights generator re-aggregates it — it never needs per-event granularity.
 *
 * PRIVACY: rows are keyed by the anonymous `devId` only — never a name, login, or email — and
 * carry counts + coarse tags (asset id, model, language, country). NEVER prompt/response content.
 */
export class MetricsCollector {
  private rows: Map<string, Record<string, unknown>> | null = null;
  private activeFile: vscode.Uri | null = null;
  private activeMonth = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly identity: DevIdentity,
  ) {}

  recordUsage(e: Omit<UsageEvent, 'kind'>): Promise<void> {
    return this.bumpToken('usage', e.model, e.inputTokens, e.outputTokens, this.dateNow(), {
      languageId: e.languageId,
      assetId: e.assetId,
      assetType: e.assetType,
    });
  }

  /** Record a Copilot OTel row, preserving its own date (not "now"). */
  recordCopilot(e: Omit<CopilotEvent, 'kind'>): Promise<void> {
    return this.bumpToken('copilot', e.model, e.inputTokens, e.outputTokens, String(e.ts).slice(0, 10), {});
  }

  async recordAsset(e: Omit<AssetEvent, 'kind'>): Promise<void> {
    try {
      await this.ensureLoaded();
      const ts = new Date().toISOString();
      const row: Record<string, unknown> = {
        schema: METRICS_SCHEMA,
        devId: this.identity.devId,
        country: this.identity.country,
        date: ts.slice(0, 10),
        kind: 'asset',
        event: e.event,
        assetId: e.assetId,
        assetType: e.assetType,
        ...(e.marketplace ? { marketplace: e.marketplace } : {}),
        ts,
      };
      // Unique key → each lifecycle event is preserved (downstream counts them per-row).
      this.rows!.set(['a', ts, e.event, e.assetId].join(SEP), row);
      if (isTelemetryDebugEnabled()) logMetricEvent(row, 'metricsCollector');
      this.markDirty();
    } catch (e2) {
      logError('Failed to record asset metric', e2, 'analytics');
    }
  }

  /** Directory holding all of this dev's monthly files (what auto-submit uploads). */
  devDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'perf', this.identity.devId);
  }

  /** Persist any pending aggregates immediately (call before submitting / on shutdown). */
  async flushNow(): Promise<void> {
    if (this.dirty) await this.flush();
    else this.clearTimer();
  }

  // ── Aggregation internals ─────────────────────────────────────────────────────

  /** Upsert a token row: same (date,model,country,language,asset) → sum tokens, +1 request. */
  private async bumpToken(
    kind: 'usage' | 'copilot',
    model: string,
    inputTokens: number,
    outputTokens: number,
    date: string,
    tags: { languageId?: string; assetId?: string; assetType?: string },
  ): Promise<void> {
    try {
      await this.ensureLoaded();
      const languageId = tags.languageId || '';
      const assetId = tags.assetId || '';
      const assetType = tags.assetType || '';
      const m = model || 'unknown';
      const key = ['t', date, kind, m, assetId, assetType, languageId].join(SEP);
      const existing = this.rows!.get(key);
      if (existing) {
        existing.requests = (existing.requests as number) + 1;
        existing.inputTokens = (existing.inputTokens as number) + num(inputTokens);
        existing.outputTokens = (existing.outputTokens as number) + num(outputTokens);
      } else {
        this.rows!.set(key, {
          schema: METRICS_SCHEMA,
          devId: this.identity.devId,
          country: this.identity.country,
          date,
          kind,
          model: m,
          ...(languageId ? { languageId } : {}),
          ...(assetId ? { assetId } : {}),
          ...(assetType ? { assetType } : {}),
          requests: 1,
          inputTokens: num(inputTokens),
          outputTokens: num(outputTokens),
        });
      }
      this.markDirty();
    } catch (e) {
      logError('Failed to record token metric', e, 'analytics');
    }
  }

  /** Hydrate the in-memory map from the current month's file (re-aggregating any legacy per-event rows). */
  private async ensureLoaded(): Promise<void> {
    const month = this.monthNow();
    if (this.rows && this.activeMonth === month) return;
    // Real month rolled over → persist the old month before switching files.
    if (this.rows && this.activeMonth && this.activeMonth !== month) await this.flush();

    this.activeMonth = month;
    this.activeFile = vscode.Uri.joinPath(this.devDir(), `${month}.ndjson`);
    const map = new Map<string, Record<string, unknown>>();
    for (const line of (await this.readIfPresent(this.activeFile)).split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let r: Record<string, unknown>;
      try { r = JSON.parse(t); } catch { continue; }
      this.foldRow(map, r);
    }
    this.rows = map;
  }

  /** Fold an existing on-disk row into the aggregate (so legacy per-event files compact on next write). */
  private foldRow(map: Map<string, Record<string, unknown>>, r: Record<string, unknown>): void {
    const schema = typeof r.schema === 'string' ? r.schema : '';
    const kind = (r.kind as string) || (schema.startsWith('copilot-tokens') ? 'copilot' : '');
    if (kind === 'copilot' || kind === 'usage') {
      const date = (r.date as string) || (r.ts ? String(r.ts).slice(0, 10) : '');
      const model = (r.model as string) || 'unknown';
      const languageId = (r.languageId as string) || '';
      const assetId = (r.assetId as string) || '';
      const assetType = (r.assetType as string) || '';
      const reqs = typeof r.requests === 'number' && r.requests > 0 ? r.requests : 1;
      const key = ['t', date, kind, model, assetId, assetType, languageId].join(SEP);
      const ex = map.get(key);
      if (ex) {
        ex.requests = (ex.requests as number) + reqs;
        ex.inputTokens = (ex.inputTokens as number) + num(r.inputTokens);
        ex.outputTokens = (ex.outputTokens as number) + num(r.outputTokens);
      } else {
        map.set(key, {
          schema: METRICS_SCHEMA,
          devId: this.identity.devId,
          country: (r.country as string) ?? this.identity.country,
          date,
          kind,
          model,
          ...(languageId ? { languageId } : {}),
          ...(assetId ? { assetId } : {}),
          ...(assetType ? { assetType } : {}),
          requests: reqs,
          inputTokens: num(r.inputTokens),
          outputTokens: num(r.outputTokens),
        });
      }
    } else if (kind === 'asset') {
      const ts = (r.ts as string) || '';
      map.set(['a', ts, r.event as string, r.assetId as string].join(SEP), r);
    } else {
      map.set(['x', map.size].join(SEP), r); // unknown row — preserve verbatim
    }
  }

  private async flush(): Promise<void> {
    this.clearTimer();
    if (!this.rows || !this.activeFile) return;
    try {
      const body = [...this.rows.values()].map((r) => JSON.stringify(r)).join('\n');
      await vscode.workspace.fs.createDirectory(this.devDir());
      await vscode.workspace.fs.writeFile(this.activeFile, Buffer.from(body ? body + '\n' : '', 'utf8'));
      this.dirty = false;
    } catch (e) {
      logError('Failed to flush metrics', e, 'analytics');
    }
  }

  private markDirty(): void {
    this.dirty = true;
    this.clearTimer();
    this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DEBOUNCE_MS);
  }

  private clearTimer(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
  }

  private monthNow(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private dateNow(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async readIfPresent(uri: vscode.Uri): Promise<string> {
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      return '';
    }
  }
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }
  return 0;
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
