// Re-export hub so webview files import the shared protocol via a short, stable path
// (the single source of truth lives in ../src/shared/protocol.ts, also used by the extension).
export * from '../src/shared/protocol';
