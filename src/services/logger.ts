import * as vscode from 'vscode';

/**
 * A single shared output channel for the extension — the place users open to see
 * what Agent Studio is doing (activation, auth, marketplace fetches, the webview
 * lifecycle, and any errors relayed from the webview).
 *
 * Usage: call `initLogger(context)` once in activate(), then `log()`/`warn()`/
 * `error()` anywhere. `Agent Studio: Show Logs` reveals the channel.
 */
let channel: vscode.OutputChannel | undefined;

export function initLogger(context: vscode.ExtensionContext): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Agent Studio');
    context.subscriptions.push(channel);
  }
  return channel;
}

function stamp(): string {
  // Date.now()/new Date() are fine at runtime in the extension host.
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function write(level: string, scope: string, message: string): void {
  channel?.appendLine(`[${stamp()}] ${level} ${scope ? `(${scope}) ` : ''}${message}`);
}

export function log(message: string, scope = ''): void { write('INFO ', scope, message); }
export function warn(message: string, scope = ''): void { write('WARN ', scope, message); }

export function error(message: string, err?: unknown, scope = ''): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : err !== undefined ? String(err) : '';
  write('ERROR', scope, detail ? `${message} — ${detail}` : message);
}

/** Reveal the channel (wired to the `agentStudio.showLogs` command). */
export function showLogs(): void { channel?.show(true); }
