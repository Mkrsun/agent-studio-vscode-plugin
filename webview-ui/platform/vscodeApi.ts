import type { WebviewMessage } from '../protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Must be called exactly once per webview lifetime.
const vscode = acquireVsCodeApi();

/** Send a typed message to the extension host. */
export function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}
