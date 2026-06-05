import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '../services/configService';
import { CONFIG_KEYS } from '../constants';
import { resolveIdentity, DevIdentity } from './identity';
import { MetricsCollector, UsageEvent, AssetEvent } from './metricsCollector';
import { pushUsageFiles, UsageFile } from './usageSubmitter';
import { log, warn as logWarn, error as logError, showLogs as showLogsChannel } from '../services/logger';

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 6 * 60 * 60 * 1000; // re-import OTel + maybe submit, every 6h
const NOTICE_KEY = 'agentStudio.analytics.noticeShown';
const LAST_SUBMIT_KEY = 'agentStudio.analytics.lastSubmit';
const OTEL_OFFSET_KEY = 'agentStudio.analytics.otelOffset';
const COPILOT_OTEL_SETTING = 'github.copilot.chat.otel.outfile';
const COPILOT_OTEL_ENABLED_SETTING = 'github.copilot.chat.otel.enabled';
const COPILOT_OTEL_EXPORTER_SETTING = 'github.copilot.chat.otel.exporterType';

/**
 * Owns the anonymous-analytics pipeline: collect numbers-only metrics locally,
 * import Copilot's OTel token export, and auto-PR them to the analytics repo —
 * no Actions, no `gh`, no names. Auto/opt-out: ON unless the dev disables it.
 *
 * `recordAsset` / `recordUsage` are safe no-ops when analytics is off or before
 * `start()`, so callers never need to guard.
 */
export class AnalyticsService implements vscode.Disposable {
  private identity: DevIdentity | undefined;
  private collector: MetricsCollector | undefined;
  private otelFile = '';
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly config: ConfigService,
    private readonly getToken: () => Promise<string | null>,
  ) {}

  /**
   * Resolve identity, show the one-time notice, enable OTel, import + maybe submit.
   * Fully fail-soft: any error here is logged and swallowed so analytics can NEVER
   * break activation — including when the analytics repo is unset or unreachable
   * (collection is local and independent; submission just no-ops/logs).
   */
  async start(): Promise<void> {
    try {
      if (!this.config.isAnalyticsEnabled()) {
        log('Analytics disabled — not collecting.', 'analytics');
        return;
      }
      this.identity = await resolveIdentity(this.context);
      this.collector = new MetricsCollector(this.context, this.identity);
      log(`Analytics on (devId=${this.identity.devId.slice(0, 8)}…, country=${this.identity.country || '?'})`, 'analytics');

      await this.showNoticeOnce();
      if (!this.config.isAnalyticsEnabled()) return; // dev disabled it in the notice

      await this.enableCopilotOtel();
      await this.importCopilotOtel();
      void this.maybeAutoSubmit();
      this.timer = setInterval(() => void this.tick(), TICK_MS);
    } catch (e) {
      // Collection may still work even if startup extras failed; never rethrow.
      logError('Analytics startup error (continuing without it)', e, 'analytics');
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    void this.collector?.flushNow(); // persist any pending aggregates on shutdown
  }

  // ── Recording (called from across the extension) ────────────────────────────

  recordAsset(e: Omit<AssetEvent, 'kind'>): void {
    if (this.collector && this.config.isAnalyticsEnabled()) void this.collector.recordAsset(e);
  }

  recordUsage(e: Omit<UsageEvent, 'kind'>): void {
    if (this.collector && this.config.isAnalyticsEnabled()) void this.collector.recordUsage(e);
  }

  /** Command handler: import OTel then submit now, with user feedback. */
  async submitNow(): Promise<void> {
    if (!this.collector) {
      vscode.window.showInformationMessage('Agent Studio: analytics is disabled.');
      return;
    }
    await this.importCopilotOtel();
    await this.submit(true);
  }

  /**
   * Command handler: print a full diagnostic of the analytics pipeline to the
   * output channel (and a one-line toast) — the place to look when asking
   * "is data being gathered, and is Copilot's OTel export actually flowing?".
   */
  async showStatus(): Promise<void> {
    const enabled = this.config.isAnalyticsEnabled();
    const otelExists = this.otelFile ? await this.fileSize(this.otelFile) : -1;
    const offset = this.context.globalState.get<number>(OTEL_OFFSET_KEY) ?? 0;
    const last = this.context.globalState.get<number>(LAST_SUBMIT_KEY) ?? 0;
    const files = this.collector ? await this.collectFiles() : [];
    const rows = files.reduce((n, f) => n + Buffer.from(f.contentB64, 'base64').toString('utf8').split('\n').filter(Boolean).length, 0);

    log('── Analytics status ───────────────────────────────', 'analytics');
    log(`enabled:        ${enabled}`, 'analytics');
    log(`devId:          ${this.identity?.devId ?? '(none)'}`, 'analytics');
    log(`country/locale: ${this.identity?.country || '?'} / ${this.identity?.locale || '?'} (${this.identity?.timezone || '?'})`, 'analytics');
    log(`analyticsRepo:  ${this.config.getAnalyticsRepo() || '(unset — collecting locally only)'}`, 'analytics');
    log(`autoSubmit:     ${this.config.isAnalyticsAutoSubmit()}   lastSubmit: ${last ? new Date(last).toISOString() : 'never'}`, 'analytics');
    log(`Copilot OTel:   ${this.otelFile || '(disabled)'}`, 'analytics');
    log(`  → file:       ${otelExists < 0 ? 'NOT created by Copilot yet' : `${otelExists} bytes`}   imported offset: ${offset}`, 'analytics');
    log(`buffered:       ${files.length} file(s), ${rows} metric row(s)`, 'analytics');
    log('───────────────────────────────────────────────────', 'analytics');
    showLogsChannel();

    vscode.window.showInformationMessage(
      `Agent Studio analytics: ${rows} local row(s); Copilot OTel ${otelExists < 0 ? 'not flowing yet (see logs)' : `${otelExists}B`}.`,
    );
  }

  private async fileSize(fsPath: string): Promise<number> {
    try {
      return (await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))).size;
    } catch {
      return -1;
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    try {
      if (!this.config.isAnalyticsEnabled()) return;
      await this.importCopilotOtel();
      await this.maybeAutoSubmit();
    } catch (e) {
      logError('Analytics tick error (ignored)', e, 'analytics');
    }
  }

  private async maybeAutoSubmit(): Promise<void> {
    if (!this.config.isAnalyticsAutoSubmit()) return;
    const last = this.context.globalState.get<number>(LAST_SUBMIT_KEY) ?? 0;
    if (Date.now() - last < DAY_MS) return;
    await this.submit(false);
  }

  private async submit(interactive: boolean): Promise<void> {
    const repo = this.config.getAnalyticsRepo();
    if (!repo.includes('/')) {
      if (interactive) {
        vscode.window.showErrorMessage(
          'Agent Studio: set an analytics repo first (agentStudio.analyticsRepo or AGENT_STUDIO_ANALYTICS_REPO).',
        );
      }
      return;
    }
    const files = await this.collectFiles();
    if (files.length === 0) {
      if (interactive) vscode.window.showInformationMessage('Agent Studio: no metrics collected yet.');
      return;
    }
    const token = await this.getToken();
    if (!token) {
      if (interactive) vscode.window.showErrorMessage('Agent Studio: sign in with GitHub to submit metrics.');
      return;
    }

    try {
      const url = await pushUsageFiles(repo, this.identity!.devId, files, token);
      await this.context.globalState.update(LAST_SUBMIT_KEY, Date.now());
      log(`Submitted ${files.length} anonymous metric file(s) → PR ${url}`, 'analytics');
      if (interactive) {
        const action = await vscode.window.showInformationMessage(
          `✅ Submitted ${files.length} anonymous metric file(s) → PR opened.`,
          'Open PR',
        );
        if (action === 'Open PR') vscode.env.openExternal(vscode.Uri.parse(url));
      }
    } catch (e) {
      logError('Metric submission failed', e, 'analytics');
      if (interactive) vscode.window.showErrorMessage(`Agent Studio: submission failed — ${(e as Error).message}`);
    }
  }

  private async collectFiles(): Promise<UsageFile[]> {
    await this.collector!.flushNow(); // make sure pending in-memory aggregates are on disk first
    const dir = this.collector!.devDir();
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return [];
    }
    const out: UsageFile[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.ndjson')) continue;
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name));
      out.push({ name, contentB64: Buffer.from(bytes).toString('base64') });
    }
    return out;
  }

  /** One-time, friendly opt-out notice. */
  private async showNoticeOnce(): Promise<void> {
    if (this.context.globalState.get<boolean>(NOTICE_KEY)) return;
    await this.context.globalState.update(NOTICE_KEY, true);
    const action = await vscode.window.showInformationMessage(
      'Agent Studio collects anonymous usage metrics — numbers + coarse tags only (no name, no code, no prompts) — ' +
        'to surface AI-asset insights for your team. You can turn this off anytime.',
      'Got it',
      'Disable',
    );
    if (action === 'Disable') {
      await vscode.workspace
        .getConfiguration()
        .update(CONFIG_KEYS.ANALYTICS_ENABLED, false, vscode.ConfigurationTarget.Global);
      log('Analytics disabled by the user via the notice.', 'analytics');
    }
  }

  /**
   * Point Copilot's OTel export at a known file so real token counts flow.
   *
   * Writing the outfile path alone is NOT enough: per Copilot's OTel docs, OTel
   * only activates when `otel.enabled` (or an OTLP endpoint / env flag) is set,
   * and output only reaches a file when `otel.exporterType` is "file" (the
   * default is "otlp-http", which POSTs to a collector instead). So we set all
   * three together. We never clobber a user who already configured their own
   * exporter (e.g. an OTLP endpoint to their team's collector) — in that case we
   * just adopt their outfile if they happen to also write one, and otherwise
   * leave them alone.
   */
  private async enableCopilotOtel(): Promise<void> {
    if (!this.config.isAutoEnableCopilotOtel()) {
      this.otelFile = '';
      return;
    }
    const cfg = vscode.workspace.getConfiguration();

    // Respect an existing user setup, but ONLY a real user override — `get()`
    // folds in Copilot's package default ("otlp-http"), so we must `inspect()`
    // and look at the explicit user/workspace value. If the user deliberately
    // chose a non-file exporter (e.g. their own OTLP collector), don't hijack it
    // — just tail their file if they have one, otherwise stay out of the way.
    const exporterInspect = cfg.inspect<string>(COPILOT_OTEL_EXPORTER_SETTING);
    const userExporter =
      exporterInspect?.workspaceFolderValue ?? exporterInspect?.workspaceValue ?? exporterInspect?.globalValue;
    const existingOutfile = cfg.get<string>(COPILOT_OTEL_SETTING);
    if (userExporter && userExporter !== 'file') {
      this.otelFile = existingOutfile || '';
      log(`Copilot OTel already configured by user (exporter=${userExporter}); not overriding.`, 'analytics');
      return;
    }

    const target = existingOutfile || path.join(os.homedir(), '.copilot-otel', 'usage.jsonl');
    try {
      // Create the directory so Copilot can write into it (it may not mkdir -p).
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
      // All three are required for file-based token export to actually flow.
      await cfg.update(COPILOT_OTEL_ENABLED_SETTING, true, vscode.ConfigurationTarget.Global);
      await cfg.update(COPILOT_OTEL_EXPORTER_SETTING, 'file', vscode.ConfigurationTarget.Global);
      await cfg.update(COPILOT_OTEL_SETTING, target, vscode.ConfigurationTarget.Global);
      this.otelFile = target;
      log(`Enabled Copilot OTel file export → ${target}`, 'analytics');
      log('NOTE: Copilot only starts writing after a window reload, and only if your', 'analytics');
      log('      Copilot build supports this export. Run "Agent Studio: Analytics Status" to check.', 'analytics');
    } catch (e) {
      logWarn('Could not enable Copilot OTel export (continuing without true token data).', 'analytics');
    }
  }

  /**
   * Import NEW Copilot OTel rows into the collector, reading ONLY the bytes
   * appended since last time (a true byte offset) rather than loading the whole
   * file. The export grows unbounded — Copilot owns the file and holds it open,
   * so we must NOT truncate it — and a full read would get costly over weeks. We
   * advance the offset only up to the last complete line, leaving any half-written
   * trailing line for the next tick, and reset to 0 if the file shrank (rotated).
   */
  private async importCopilotOtel(): Promise<void> {
    if (!this.otelFile || !this.collector) return;

    let size: number;
    try {
      size = (await vscode.workspace.fs.stat(vscode.Uri.file(this.otelFile))).size;
    } catch {
      return; // file not created by Copilot yet
    }

    let offset = this.context.globalState.get<number>(OTEL_OFFSET_KEY) ?? 0;
    if (offset > size) offset = 0; // file rotated/truncated → re-read from the start
    if (size <= offset) return; // nothing new appended

    let buf: Buffer;
    try {
      buf = await readFileRange(this.otelFile, offset, size);
    } catch {
      logWarn('Could not read Copilot OTel file range; will retry next tick.', 'analytics');
      return;
    }

    // Consume only up to the last newline; a trailing partial line means Copilot
    // is mid-write, so we leave those bytes for the next tick.
    const lastNl = buf.lastIndexOf(0x0a); // '\n'
    if (lastNl < 0) return; // no complete line in the new bytes yet
    const consumed = lastNl + 1;

    let imported = 0;
    for (const line of buf.subarray(0, consumed).toString('utf8').split(/\r?\n/)) {
      const row = parseOtelLine(line);
      if (row) {
        await this.collector.recordCopilot(row);
        imported++;
      }
    }
    // Persist the aggregated batch BEFORE advancing the offset, so a crash can only ever cause a
    // re-import (idempotent-ish) — never a silently-dropped, already-consumed batch.
    await this.collector.flushNow();
    await this.context.globalState.update(OTEL_OFFSET_KEY, offset + consumed);
    if (imported > 0) log(`Imported ${imported} Copilot token row(s) from OTel.`, 'analytics');
  }
}

/** Read bytes [start, end) of a file without pulling the rest into memory. */
async function readFileRange(file: string, start: number, end: number): Promise<Buffer> {
  const length = end - start;
  const fd = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fd.read(buf, 0, length, start);
    return bytesRead === length ? buf : buf.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}

/**
 * Tolerant extraction of token counts from one OTel/OTLP JSON line. The shape
 * varies (flat keys vs an attributes:[{key,value:{intValue|stringValue}}] array,
 * possibly nested) — so we walk the parsed object and collect any gen_ai.* key we
 * recognize. Returns null when the line has no usable token data.
 */
function parseOtelLine(line: string): { model: string; inputTokens: number; outputTokens: number; ts: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const found: Record<string, string | number> = {};
  walk(parsed, found);

  // Copilot emits each request's usage in TWO log records: the authoritative per-inference
  // record (event.name = "gen_ai.client.inference.operation.details", which carries the model)
  // AND the agent-turn record ("copilot_chat.agent.turn" — same token counts, but NO model).
  // Counting both DOUBLES every total and produces a junk "unknown" model bucket, so we accept
  // ONLY the inference record. Aggregate metric exports (scopeMetrics/…) have no event.name and
  // are skipped here too — the per-inference log record is the single source of truth.
  if (found['event.name'] !== 'gen_ai.client.inference.operation.details') return null;

  const input = num(found['gen_ai.usage.input_tokens']);
  const output = num(found['gen_ai.usage.output_tokens']);
  if (input === 0 && output === 0) return null;

  const model = String(found['gen_ai.request.model'] ?? found['gen_ai.response.model'] ?? 'unknown');
  const ts = typeof found['__ts'] === 'string' ? (found['__ts'] as string) : new Date().toISOString();
  return { model, inputTokens: input, outputTokens: output, ts };
}

const WANTED = new Set(['gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens', 'gen_ai.request.model', 'gen_ai.response.model', 'event.name']);

function walk(node: unknown, out: Record<string, string | number>): void {
  if (node === null || typeof node !== 'object') return;

  // OTLP attribute object: { key, value: { intValue | stringValue } }
  const asAttr = node as { key?: unknown; value?: { intValue?: unknown; stringValue?: unknown } };
  if (typeof asAttr.key === 'string' && asAttr.value && typeof asAttr.value === 'object') {
    const v = asAttr.value.intValue ?? asAttr.value.stringValue;
    if (WANTED.has(asAttr.key) && (typeof v === 'string' || typeof v === 'number')) out[asAttr.key] = v;
  }

  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (WANTED.has(k) && (typeof v === 'string' || typeof v === 'number')) out[k] = v;
    // Real event time. Copilot's log record carries hrTime: [seconds, nanos]; OTLP carries *UnixNano.
    if (k === 'hrTime' && !out['__ts'] && Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
      out['__ts'] = isoFrom(v[0] * 1000 + v[1] / 1e6);
    }
    if ((k === 'timeUnixNano' || k === 'time' || k === 'timestamp') && !out['__ts']) {
      out['__ts'] = isoFrom(v);
    }
    if (v && typeof v === 'object') walk(v, out);
  }
}

function num(v: string | number | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }
  return 0;
}

function isoFrom(v: unknown): string {
  if (typeof v === 'string') return v.length > 12 ? v : new Date().toISOString();
  if (typeof v === 'number') {
    // nanoseconds → ms heuristic
    const ms = v > 1e15 ? Math.floor(v / 1e6) : v;
    try { return new Date(ms).toISOString(); } catch { return new Date().toISOString(); }
  }
  return new Date().toISOString();
}
