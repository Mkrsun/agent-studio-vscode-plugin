import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../services/configService';
import { CONFIG_KEYS } from '../constants';
import { resolveIdentity, DevIdentity } from './identity';
import { MetricsCollector, UsageEvent, AssetEvent } from './metricsCollector';
import { pushUsageFiles, UsageFile } from './usageSubmitter';
import { log, warn as logWarn, error as logError } from '../services/logger';

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 6 * 60 * 60 * 1000; // re-import OTel + maybe submit, every 6h
const NOTICE_KEY = 'agentStudio.analytics.noticeShown';
const LAST_SUBMIT_KEY = 'agentStudio.analytics.lastSubmit';
const OTEL_OFFSET_KEY = 'agentStudio.analytics.otelOffset';
const COPILOT_OTEL_SETTING = 'github.copilot.chat.otel.outfile';

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

  /** Point Copilot's OTel export at a known file so real token counts flow. */
  private async enableCopilotOtel(): Promise<void> {
    if (!this.config.isAutoEnableCopilotOtel()) {
      this.otelFile = '';
      return;
    }
    const cfg = vscode.workspace.getConfiguration();
    const current = cfg.get<string>(COPILOT_OTEL_SETTING);
    if (current) {
      this.otelFile = current;
      return;
    }
    const target = path.join(os.homedir(), '.copilot-otel', 'usage.jsonl');
    try {
      await cfg.update(COPILOT_OTEL_SETTING, target, vscode.ConfigurationTarget.Global);
      this.otelFile = target;
      log(`Enabled Copilot OTel token export → ${target}`, 'analytics');
    } catch (e) {
      logWarn('Could not enable Copilot OTel export (continuing without true token data).', 'analytics');
    }
  }

  /** Import NEW Copilot OTel rows (by byte offset) into the collector. */
  private async importCopilotOtel(): Promise<void> {
    if (!this.otelFile || !this.collector) return;
    let text: string;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(this.otelFile))).toString('utf8');
    } catch {
      return; // file not created by Copilot yet
    }
    const offset = this.context.globalState.get<number>(OTEL_OFFSET_KEY) ?? 0;
    if (text.length <= offset) return;

    let imported = 0;
    for (const line of text.slice(offset).split(/\r?\n/)) {
      const row = parseOtelLine(line);
      if (row) {
        await this.collector.recordCopilot(row);
        imported++;
      }
    }
    await this.context.globalState.update(OTEL_OFFSET_KEY, text.length);
    if (imported > 0) log(`Imported ${imported} Copilot token row(s) from OTel.`, 'analytics');
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

  const input = num(found['gen_ai.usage.input_tokens']);
  const output = num(found['gen_ai.usage.output_tokens']);
  if (input === 0 && output === 0) return null;

  const model = String(found['gen_ai.request.model'] ?? found['gen_ai.response.model'] ?? 'unknown');
  const ts = typeof found['__ts'] === 'string' ? (found['__ts'] as string) : new Date().toISOString();
  return { model, inputTokens: input, outputTokens: output, ts };
}

const WANTED = new Set(['gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens', 'gen_ai.request.model', 'gen_ai.response.model']);

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
