import * as vscode from 'vscode';
import { ExecutionTracker } from '../visualizer/executionTracker';
import { AgentGraphBuilder } from './agentGraphBuilder';
import { InspectorSession } from './inspectorSession';
import { PluginRegistry } from '../marketplace/pluginRegistry';
import { AgentMessage, FrameworkPreview, ToolInvocation, WebviewMessage, WorkflowExecution } from '../models/types';
import { getNonce } from '../utils/webviewUtils';

type PillState = 'idle' | 'running' | 'failed';

function toPillState(status: WorkflowExecution['status']): PillState {
  if (status === 'running') return 'running';
  if (status === 'failed')  return 'failed';
  return 'idle';
}

/** Singleton webview panel. */
export class InspectorPanel {
  static currentPanel: InspectorPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _graphBuilder = new AgentGraphBuilder();
  private readonly _session: InspectorSession;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(
    context: vscode.ExtensionContext,
    tracker: ExecutionTracker,
    pluginRegistry: PluginRegistry,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Two;

    if (InspectorPanel.currentPanel) {
      InspectorPanel.currentPanel._panel.reveal(column);
      InspectorPanel.currentPanel._pushLatest();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'agentStudioInspector',
      'Agent Inspector',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
        ],
      },
    );

    InspectorPanel.currentPanel = new InspectorPanel(panel, context, tracker, pluginRegistry);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly tracker: ExecutionTracker,
    private readonly pluginRegistry: PluginRegistry,
  ) {
    this._panel = panel;
    this._session = new InspectorSession(tracker);
    this._panel.webview.html = this._getHtml();

    pluginRegistry.onDidChange(
      () => this._pushInit(),
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this._handleMessage(msg),
      null,
      this._disposables,
    );

    tracker.onExecutionUpdate(
      (execution) => {
        if (!this._panel.visible) return;
        this._broadcastExecution(execution);
      },
      null,
      this._disposables,
    );

    // The tracker passes the associated entity alongside the event to avoid linear scans.
    tracker.onEvent(
      ({ event, entity }) => {
        if (!this._panel.visible) return;
        const payload = event.payload;
        const message = payload?.kind === 'message' ? entity as AgentMessage    : undefined;
        const tool    = payload?.kind === 'tool'    ? entity as ToolInvocation  : undefined;
        this._panel.webview.postMessage({
          type: 'inspector:event',
          event,
          ...(message ? { message } : {}),
          ...(tool ? { tool } : {}),
        });
      },
      null,
      this._disposables,
    );

    this._panel.onDidDispose(
      () => {
        InspectorPanel.currentPanel = undefined;
        this._session.dispose();
        this._disposables.forEach((d) => d.dispose());
      },
      null,
      this._disposables,
    );
  }

  private _handleMessage(msg: WebviewMessage): void {
    switch (msg.type) {
      case 'inspector:ready':
      case 'inspector:requestSnapshot':
        this._pushInit();
        this._pushLatest();
        break;

      case 'inspector:runPlayground': {
        const { runId, prompt, target, frameworkPluginName } = msg;
        this._session.run(
          { runId, prompt, target, frameworkPluginName },
          {
            onChunk: (id, chunk) => {
              this._panel.webview.postMessage({
                type: 'inspector:playgroundStream',
                runId: id,
                chunk,
              });
            },
            onComplete: (id, ok, errorMessage) => {
              this._panel.webview.postMessage({
                type: 'inspector:playgroundComplete',
                runId: id,
                ok,
                errorMessage,
              });
            },
          },
        );
        break;
      }

      case 'inspector:cancelPlayground':
        this._session.cancel(msg.runId);
        break;

      case 'inspector:selectFramework': {
        const { pluginName } = msg;
        if (!pluginName) {
          this._pushLatest();
          break;
        }
        const record = this.pluginRegistry.getInstalledByName(pluginName);
        if (!record) break;
        const graph = this._graphBuilder.buildFromPlugin(record);
        const { dsl } = this._graphBuilder.toMermaid(graph);
        this._panel.webview.postMessage({
          type: 'inspector:diagramUpdate',
          mermaidDsl: dsl,
          mode: 'planned',
        });
        this._panel.webview.postMessage({
          type: 'inspector:statusPill',
          state: 'idle',
          detail: `Plan preview — ${pluginName}`,
        });
        break;
      }

      case 'inspector:runFramework': {
        const { pluginName } = msg;
        const record = this.pluginRegistry.getInstalledByName(pluginName);
        const triggerPhrase = record ? `run ${pluginName}` : `run framework ${pluginName}`;
        vscode.commands.executeCommand(
          'workbench.action.chat.open',
          { query: `@agent-studio ${triggerPhrase}` },
        );
        break;
      }

      case 'inspector:copyIoJson': {
        const exec = this.tracker.getLatest();
        if (exec?.messages?.length) {
          vscode.env.clipboard.writeText(JSON.stringify(exec.messages, null, 2));
        }
        break;
      }
    }
  }

  private _broadcastExecution(execution: WorkflowExecution): void {
    const graph = this._graphBuilder.buildFromExecution(execution);
    const { dsl, edgeIndex } = this._graphBuilder.toMermaid(graph);

    let activeEdgeKey: string | undefined;
    if (graph.activeAgentId) {
      const incoming = graph.edges.find((e) => e.to === graph.activeAgentId);
      if (incoming) activeEdgeKey = edgeIndex[incoming.key];
    }

    this._panel.webview.postMessage({
      type: 'inspector:diagramUpdate',
      mermaidDsl: dsl,
      activeAgentId: graph.activeAgentId,
      activeEdgeKey,
      mode: 'live',
    });
    this._panel.webview.postMessage({
      type: 'inspector:executionSnapshot',
      execution,
    });
    this._panel.webview.postMessage({
      type: 'inspector:statusPill',
      state: toPillState(execution.status),
      detail: execution.status === 'running' ? (execution.currentStepId ?? 'running') : execution.status,
    });
  }

  private _pushInit(): void {
    const frameworks: FrameworkPreview[] = this.pluginRegistry.getInstalled()
      .filter((p) => p.type === 'framework')
      .map((p) => ({
        pluginName: p.name,
        displayName: p.name,
        subAgents: [],
        phases: (p.phases ?? []).map((name) => ({ name })),
        strategy: undefined,
      }));

    this._panel.webview.postMessage({
      type: 'inspector:init',
      installedFrameworks: frameworks,
      participantAvailable: true,
    });
  }

  private _pushLatest(): void {
    const latest = this.tracker.getLatest();
    if (!latest) {
      this._panel.webview.postMessage({ type: 'inspector:executionSnapshot', execution: null });
      this._panel.webview.postMessage({ type: 'inspector:statusPill', state: 'idle', detail: 'No active workflow' });
      return;
    }
    this._broadcastExecution(latest);
  }

  private _getHtml(): string {
    const webview = this._panel.webview;
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'inspector', 'inspector.css'),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'inspector-webview.js'),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}' ${webview.cspSource};
             img-src ${webview.cspSource} data:;">
  <link rel="stylesheet" href="${cssUri}">
  <title>Agent Inspector</title>
</head>
<body>
  <div id="app">
    <header class="ins-header">
      <div class="ins-header__title">
        <span class="ins-header__icon">⬡</span>
        <h1>Agent Inspector</h1>
      </div>
      <div class="ins-header__controls">
        <select id="insFrameworkDropdown" class="ins-dropdown">
          <option value="">(live workflow)</option>
        </select>
        <button class="ins-btn ins-btn--primary" id="insRunBtn" disabled>Run</button>
      </div>
      <div id="insStatusPill" class="ins-status ins-status--idle">
        <span class="ins-status__dot"></span>
        <span class="ins-status__label">Idle</span>
      </div>
    </header>

    <section class="ins-diagram-wrap">
      <div id="insDiagram" class="ins-diagram">
        <div class="ins-empty">
          <p>No active workflow.</p>
          <p class="ins-hint">Start one with <code>@agent-studio /workflow full-feature-workflow</code></p>
        </div>
      </div>
    </section>

    <nav class="ins-tabs">
      <button class="ins-tab" data-tab="panelPlayground">Playground</button>
      <button class="ins-tab" data-tab="panelIO">Input &amp; Output</button>
      <button class="ins-tab" data-tab="panelEvents">Events</button>
      <button class="ins-tab" data-tab="panelTools">Tools</button>
      <button class="ins-tab active" data-tab="panelTraces">Traces</button>
    </nav>

    <div id="panelPlayground" class="ins-panel">
      <div id="insPlaygroundMessages" class="ins-pg-messages">
        <div class="ins-empty"><p>Send a message to the agent.</p></div>
      </div>
      <div class="ins-pg-input-row">
        <select id="insPlaygroundTarget" class="ins-dropdown" style="min-width:130px">
          <option value="model">Raw model</option>
          <option value="participant">@agent-studio</option>
        </select>
        <textarea id="insPlaygroundInput" class="ins-pg-textarea"
          placeholder="Type a message…" rows="2"></textarea>
        <div class="ins-pg-actions">
          <button class="ins-btn ins-btn--primary" id="insPlaygroundSend">Send</button>
          <button class="ins-btn ins-btn--secondary" id="insPlaygroundCancel" disabled>Cancel</button>
        </div>
      </div>
    </div>

    <div id="panelIO" class="ins-panel">
      <div class="ins-io-toolbar">
        <span class="ins-io-toolbar__label">Messages exchanged with the language model</span>
        <button class="ins-btn ins-btn--secondary" id="insCopyIO" title="Copy all messages as JSON">Copy JSON</button>
      </div>
      <div id="insIOContent">
        <div class="ins-io-empty">No messages recorded yet.</div>
      </div>
    </div>

    <div id="panelEvents" class="ins-panel">
      <div class="ins-events-toolbar">
        <span class="ins-events-toolbar__label">Event stream</span>
        <button class="ins-btn ins-btn--secondary" id="insClearEvents">Clear</button>
      </div>
      <div id="insEventList" class="ins-event-list">
        <div class="ins-empty"><p>No events yet. Start a workflow.</p></div>
      </div>
    </div>

    <div id="panelTools" class="ins-panel">
      <div id="insToolsList" class="ins-tools-list">
        <div class="ins-tools-empty">
          <p>No tools invoked yet.</p>
          <p class="ins-placeholder__muted">Tool/skill invocations appear here as the workflow runs.</p>
        </div>
      </div>
    </div>

    <div id="panelTraces" class="ins-panel visible">
      <div id="insStepList" class="ins-step-list"></div>
    </div>
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}
