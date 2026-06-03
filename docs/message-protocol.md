# Webview ⇄ Host Protocol

The marketplace webview (React, sandboxed) and the extension host (Node) share **no
memory** — they communicate only by `postMessage`. The contract is a single TypeScript
file, `src/shared/protocol.ts`, imported by both sides. This is the most important boundary
in the codebase: get a message wrong and the UI silently breaks, so the types are the
guardrail.

## The two directions

```
            HostMessage  (host → webview)
 ┌─────────────┐  ───────────────────────────▶  ┌──────────────────┐
 │ EXTENSION   │                                  │  WEBVIEW (React) │
 │ HOST (Node) │  ◀───────────────────────────  │                  │
 └─────────────┘            WebviewMessage        └──────────────────┘
                            (webview → host)
```

- **`HostMessage`** — what the host sends _to_ the webview (catalogs, states, results).
- **`WebviewMessage`** — what the webview sends _to_ the host (user actions).

Both are discriminated unions keyed on `type` (all prefixed `marketplace:`).

## Single source of truth

```
src/shared/protocol.ts            ← defined here (DTOs + both unions)
   ▲                       ▲
   │ import                │ re-export
src/marketplace/           webview-ui/protocol.ts  ──▶  imported across webview-ui/
marketplacePanel.ts                                      (App.tsx, features/*, platform/*)
```

The webview imports the **same** file via a thin re-export (`webview-ui/protocol.ts` →
`export * from '../src/shared/protocol'`). There is no second definition to drift.

## HostMessage (host → webview)

| `type` | Payload | Meaning |
|--------|---------|---------|
| `marketplace:loadCatalog` | `{ assets: CatalogAsset[] }` | (Re)render the asset list |
| `marketplace:assetState` | `{ assetId, installed, hasUpdate, installedVersion?, availableVersion? }` | Per-asset Install/Installed/Update state |
| `marketplace:installResult` | `{ assetId, success, error? }` | Outcome of an install/update |
| `marketplace:loadMcp` | `{ servers: McpServer[] }` | Render the MCP tab |
| `marketplace:mcpState` | `{ serverId, installed }` | Per-server state |
| `marketplace:loadExtensions` | `{ extensions: CopilotExtension[] }` | Render the Copilot Extensions tab |
| `marketplace:pluginsLoading` | — | Show the plugins spinner |
| `marketplace:loadPlugins` | `{ groups: PluginGroup[] }` | Render plugins grouped by marketplace |
| `marketplace:pluginState` | `{ pluginName, installed }` | Per-plugin state |
| `marketplace:applyFilter` | `{ tab?, assetType? }` | External "browse this type" (from the sidebar) |

## WebviewMessage (webview → host)

| `type` | Payload | Triggered by |
|--------|---------|--------------|
| `marketplace:ready` | — | App mounted; host then streams catalogs |
| `marketplace:filterChange` | `{ query, assetType }` | Search/type filter (debounced 250ms) |
| `marketplace:install` | `{ assetId }` | Install button |
| `marketplace:update` | `{ assetId }` | Update button |
| `marketplace:uninstall` | `{ assetId }` | Uninstall |
| `marketplace:preview` | `{ assetId }` | Preview asset |
| `marketplace:installMcp` / `uninstallMcp` | `{ serverId }` | MCP tab actions |
| `marketplace:installPlugin` | `{ pluginName, marketplaceId }` | Plugins tab install |
| `marketplace:uninstallPlugin` | `{ pluginName }` | Plugins tab uninstall |
| `marketplace:addMarketplace` | — | "Add marketplace" affordance |
| `marketplace:refreshPlugins` | — | Refresh plugins |

## DTOs

```ts
interface CatalogAsset { id; type; name; version; description; tags?; source? }
interface AssetState   { installed; hasUpdate; installedVersion?; availableVersion? }
interface McpServer    { id; name; description; tags?; env?; requiresNpx?; requiresUvx?; installDocs? }
interface CopilotExtension { name; publisher; description; category; tags?; marketplaceUrl }
interface PluginGroup  { marketplace: PluginMarketplaceRef; plugins: PluginEntry[] }
```

(Exact fields in `src/shared/protocol.ts`.)

## Host side

`src/marketplace/marketplacePanel.ts` is fully typed against the protocol — there are
**zero `as any` casts**:

```ts
private _post(msg: HostMessage): void { this._panel.webview.postMessage(msg); }
private async _handle(msg: WebviewMessage): Promise<void> { switch (msg.type) { … } }
this._panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this._handle(msg));
```

On `marketplace:ready` the panel streams the full picture: `loadCatalog` → per-asset
`assetState` (for the whole catalog, not just the visible filter) → `loadMcp` + `mcpState`
→ `loadExtensions` → plugins (`pluginsLoading` then `loadPlugins`) → optional
`applyFilter`.

## Webview side

`webview-ui/` is **feature-driven**:

```
webview-ui/
├── index.tsx                 # createRoot(...).render(<App/>)
├── App.tsx                   # header, tabs, debounced search, posts marketplace:ready
├── protocol.ts               # re-export of src/shared/protocol
├── platform/
│   ├── vscodeApi.ts          # acquireVsCodeApi() once; post(msg: WebviewMessage)
│   └── useMessages.ts        # useMessages(handler: (m: HostMessage)=>void) via a ref
├── shared/ui.tsx             # Button, Tag, TypeBadge, EmptyState, Loading (reuse marketplace.css)
└── features/{assets,plugins,mcp,extensions}/
    ├── use<Feature>.ts       # useReducer hook: state + post()-backed actions
    └── <Feature>Tab.tsx      # presentation
```

Each feature owns a `use*` reducer hook that holds its slice of state and exposes
action functions that `post()` `WebviewMessage`s; the components are thin.

## Adding a message

To add, say, a "rate asset" action end-to-end:

1. **Define it** in `src/shared/protocol.ts`:
   - add `{ type: 'marketplace:rate'; assetId: string; stars: number }` to `WebviewMessage`
     (and/or a `HostMessage` for the response).
2. **Handle it (host)** in `marketplacePanel.ts` `_handle`'s switch — TypeScript will flag
   the new `type` as unhandled until you do.
3. **Send it (webview)** from the relevant `use<Feature>.ts` via `post({ type: 'marketplace:rate', … })`.
4. **Typecheck both** (`npm run typecheck`) — the shared union guarantees both sides agree.

Because both sides import the same union, a missing case or a wrong field is a **compile
error**, not a runtime surprise. That is the whole point of the file.

Next: [Subsystems → Webview host](./subsystems.md#7-webview-host--protocol) ·
[Extending → New tab](./extending.md#add-a-webview-tab)
