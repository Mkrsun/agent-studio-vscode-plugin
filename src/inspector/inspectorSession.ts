import * as vscode from 'vscode';
import { ExecutionTracker } from '../visualizer/executionTracker';
import { invokeAgent } from '../participant/agentInvoker';
import { PlaygroundInvocation } from '../models/types';

export type PlaygroundTarget = 'participant' | 'framework' | 'model';

export interface PlaygroundRunOpts {
  runId: string;
  prompt: string;
  target: PlaygroundTarget;
  frameworkPluginName?: string;
  systemPrompt?: string;
}

export interface PlaygroundCallbacks {
  onChunk(runId: string, chunk: string): void;
  onComplete(runId: string, ok: boolean, errorMessage?: string): void;
}

export class InspectorSession {
  private _runs = new Map<string, vscode.CancellationTokenSource>();

  constructor(private readonly tracker: ExecutionTracker) {}

  async run(opts: PlaygroundRunOpts, callbacks: PlaygroundCallbacks): Promise<void> {
    const { runId, prompt, frameworkPluginName, systemPrompt } = opts;

    this._runs.get(runId)?.cancel();
    const cts = new vscode.CancellationTokenSource();
    this._runs.set(runId, cts);

    const execution: PlaygroundInvocation = this.tracker.startPlayground({
      name: frameworkPluginName ? `${frameworkPluginName} playground` : 'Playground',
      input: prompt,
      frameworkPluginName,
    });

    const effectiveSystemPrompt =
      systemPrompt ??
      `You are Agent Studio, an AI assistant integrated into VS Code. Answer the user's question concisely and accurately.`;

    let collected = '';

    try {
      for await (const chunk of invokeAgent({
        systemPrompt: effectiveSystemPrompt,
        userPrompt: prompt,
        token: cts.token,
        onOutboundMessage: (role, text) => {
          this.tracker.recordAgentMessage(execution.id, { role, direction: 'outbound', text });
        },
      })) {
        if (cts.token.isCancellationRequested) break;
        collected += chunk;
        callbacks.onChunk(runId, chunk);
      }

      if (collected) {
        this.tracker.recordAgentMessage(execution.id, {
          role: 'assistant',
          direction: 'inbound',
          text: collected,
        });
        this.tracker.setPlaygroundOutput(execution.id, collected);
      }

      this.tracker.completeWorkflow(execution.id);
      callbacks.onComplete(runId, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.tracker.failWorkflow(execution.id, msg);
      callbacks.onComplete(runId, false, msg);
    } finally {
      this._runs.delete(runId);
      cts.dispose();
    }
  }

  cancel(runId: string): void {
    this._runs.get(runId)?.cancel();
    this._runs.delete(runId);
  }

  dispose(): void {
    for (const cts of this._runs.values()) {
      cts.cancel();
      cts.dispose();
    }
    this._runs.clear();
  }
}
