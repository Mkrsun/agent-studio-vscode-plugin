import type { WebviewMessage } from '../protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;
declare global {
  interface Window { __vscodeApi?: VsCodeApi }
}

// The HTML bootstrap acquires the API once and stashes it on window so its global
// error handlers can use it too. Reuse that instance; only acquire if absent
// (acquireVsCodeApi must be called exactly once per webview lifetime).
const vscode: VsCodeApi = window.__vscodeApi ?? acquireVsCodeApi();

/** Send a typed message to the extension host. */
export function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}
