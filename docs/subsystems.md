# Subsystems Deep-Dive

A file-by-file tour of the extension. Use this as a reference once you know the shape (see
[Architecture](./architecture.md)) and the design (see [SDD](./SDD.md)).

## File map

```
src/
├── extension.ts                 # activate(): entry point & lifecycle
├── constants.ts                 # COMMANDS, CONFIG_KEYS, ENV, VIEW_IDS, CONTEXT_KEYS, labels/icons
├── analytics/
│   └── usageSubmitter.ts        # Submit Usage command → PR to analytics repo
├── auth/
│   ├── authService.ts           # GitHub session lifecycle + org-gating
│   ├── authGate.ts              # registerAuthenticatedSurface(): wire everything
│   ├── authTypes.ts             # AuthState, SessionInfo, DenyReason
│   ├── githubClient.ts          # raw fetch GitHub API helper
│   ├── signInView.ts            # placeholder tree when unauthenticated
│   └── updateChecker.ts         # enforceLatestVersion(): self-update
├── inspector/
│   ├── inspectorProvider.ts     # TreeDataProvider (the sidebar)
│   ├── inspectorTreeItem.ts     # node classes & rendering
│   └── inspectorCommands.ts     # enable/disable/preview/inject commands
├── marketplace/
│   ├── marketplaceService.ts    # orchestrates N marketplaces
│   ├── marketplaceClient.ts     # GitHub Contents API + local fs
│   ├── marketplaceTypes.ts      # descriptor, asset ref, registry json types
│   ├── marketplacePanel.ts      # webview host + protocol handlers
│   ├── assetRegistry.ts         # in-memory query/filter over the catalog
│   ├── installer.ts             # AssetInstaller (workspace install; see note)
│   ├── assetAutoUpdate.ts       # re-export when registry version newer
│   ├── mcpInstaller.ts          # MCP catalog + .vscode/mcp.json writes
│   ├── pluginRegistry.ts        # Copilot CLI plugin marketplaces + installs
│   └── pluginTypes.ts           # plugin manifest/marketplace/types
├── participant/
│   ├── agentParticipant.ts      # registerParticipant(): @agent-studio
│   ├── workflowSelector.ts      # route request → workflow/phase/command
│   ├── contextInjector.ts       # build system prompt
│   ├── phaseRunner.ts           # run a phase, stream response
│   ├── skillRunner.ts           # /skill and /agent handlers
│   ├── agentInvoker.ts          # vscode.lm wrapper (stream chunks)
│   └── prompts/{discovery,planning,implementation}.ts  # phase templates
├── services/
│   ├── assetLoader.ts           # merge marketplace + workspace assets
│   ├── scopeService.ts          # session/repo/disabled + installed version
│   ├── copilotExporter.ts       # render assets → .github/
│   ├── configService.ts         # settings + env getters; parseMarketplacesEnv
│   ├── workspaceService.ts      # workspace file I/O
│   └── dotenv.ts                # load .env at startup; parseDotEnv
├── shared/
│   └── protocol.ts              # typed Host⇄Webview contract (see Message Protocol doc)
├── models/
│   ├── types.ts                 # Asset = Skill|Agent|Workflow|Instruction|Hook
│   └── validators.ts            # tolerant zero-dep YAML → manifest
└── utils/
    ├── version.ts               # compareVersions, isNewer
    └── webviewUtils.ts          # getNonce
webview-ui/                       # the React app (see Message Protocol doc)
scripts/                          # gen-registry.mjs, release.mjs (zero-dep tooling)
```

---

## 1. Activation & lifecycle

**`src/extension.ts` → `activate(context)`**

1. `await loadDotEnv(context)` — **before** any service reads `AGENT_STUDIO_*`.
2. Dev bypass: if `extensionMode === Development` && `auth.bypassForDev`, register the full
   surface with a `null` auth service and return.
3. Create `AuthService`; register `signIn`/`signOut`/`showAuthStatus`; show sign-in views.
4. `reconcile(state)` listener toggles the `agentStudio.authenticated` context key and, on
   `authenticated`, calls `registerAuthenticatedSurface`; on `denied`, surfaces the reason
   (and the SSO link if present).
5. `await authService.initialize()` then reconcile with the current state.

**`src/auth/authGate.ts` → `registerAuthenticatedSurface(context, authService, configService)`**
returns the disposables for the whole authenticated surface. Order matters:

1. `enforceLatestVersion` (self-update; needs the token for private update repos).
2. Construct services: `MarketplaceService`, `AssetLoader`, `ScopeService`,
   `CopilotExporter`, `McpInstaller`, `PluginRegistry`, `AssetInstaller`.
3. `marketplaceService.initialize()` → `assetLoader.loadAll()` → `autoUpdateAssets()`.
4. Subscribe to `onDidChangeCatalog` to reload + auto-update on refresh.
5. Create the Inspector TreeView; register the chat participant; register inspector
   commands, the marketplace/export/**submit-usage** commands, and plugin commands.

---

## 2. Auth & self-update (`src/auth/`)

- **`authService.ts`** — `AuthService` wraps `vscode.authentication.getSession('github', …)`.
  Scopes: `['repo','user:email']`, plus `read:org` only when org-gating is on. `initialize()`
  does a silent session restore + validation (fail-closed). `signIn`/`signOut` drive the
  `onDidChangeAuthState` event. `getAccessToken()` is the token provider passed to the
  marketplace/analytics layers. Org checks compare the user's memberships to
  `config.getRequiredOrgs()` (`env → setting → []`). SSO 403s are detected (the
  `x-github-sso` header) and surfaced with a deep link.
- **`authTypes.ts`** — `AuthState = 'unauthenticated'|'authenticating'|'authenticated'|'denied'`,
  `SessionInfo`, `DenyReason` (`misconfigured|org_denied|sso_required|github_error|signin_failed|network`).
- **`githubClient.ts`** — small raw-`fetch` helper (user, org membership) with timeouts.
- **`signInView.ts`** — the placeholder tree shown until authenticated.
- **`updateChecker.ts`** — `enforceLatestVersion()`: throttled (≤1/day), reads the latest
  Release of the update repo, compares with `utils/version`, optionally reads a
  `latest.json` manifest (`minimumVersion`/`forceUpdate`), and either downloads+installs the
  `.vsix` (token-auth) or shows a dismissible toast. Sets the `agentStudio.updating` context
  key during install. See [Release & Self-Update](./release-and-self-update.md).

---

## 3. Marketplace data layer (`src/marketplace/marketplaceService.ts`, `marketplaceClient.ts`, `marketplaceTypes.ts`)

- **`MarketplaceService`** — resolves descriptors via `_getDescriptors()`
  (`AGENT_STUDIO_MARKETPLACES` → `AGENT_STUDIO_MARKETPLACE_REPO` → `agentStudio.marketplaces`),
  seeds them `loading`, fetches all in parallel, and exposes `ResolvedMarketplace[]` +
  `getAllAssetRefs()`. Re-`refresh()`es on config change. Fires `onDidChangeCatalog`.
- **`MarketplaceClient`** — the only GitHub-content caller. `fetchRegistry()` and
  `fetchAssetContent()` over `GET /repos/{repo}/contents/{path}` (raw accept header, bearer
  token, 8s timeout, 1h cache). Supports a `localPath` source (dev). Returns typed statuses
  (`no-access|unreachable|malformed`).
- **`marketplaceTypes.ts`** — `MarketplaceDescriptor`, `MarketplaceAssetRef`,
  `MarketplaceRegistryJson`, `ResolvedMarketplace`, `MarketplaceStatus`. The
  registry contract — see [The Triad](./the-triad.md#registryjson-contract).

---

## 4. Asset pipeline (`src/services/`)

- **`assetLoader.ts`** — `AssetLoader.loadAll()` merges marketplace asset refs (fetch YAML
  → parse manifest) with workspace assets under `.agent-studio/`, keyed `marketplaceId:id`;
  applies enabled/disabled from config. Query helpers: `getById`, `getAssetsByType`,
  `getEnabledSkills/Instructions/Workflows`.
- **`scopeService.ts`** — `ScopeService` maps each asset to `session|repo|disabled`.
  Session = in-memory; repo = workspace settings (persisted, exported); installed version =
  `workspaceState`. Methods: `getScope/setScope`, `getRepoScopedIds`, `getActiveIds`,
  `isActive`, `get/setInstalledVersion`.
- **`copilotExporter.ts`** — `CopilotExporter` renders repo-scoped assets to native Copilot
  files (`exportAll/exportOne/removeOne`). Mapping table in
  [SDD §4.4](./SDD.md#44-asset-pipeline-servicesassetloaderts-scopeservicets-copilotexporterts).
  Aggregates global instructions + hooks + agent roster into
  `.github/copilot-instructions.md`.
- **`configService.ts`** — typed getters over settings + env (the `env → setting → default`
  resolution). Hosts `parseMarketplacesEnv()` and `getRequiredOrgs()`.
- **`workspaceService.ts`** — workspace file I/O helpers.
- **`dotenv.ts`** — `loadDotEnv()` + `parseDotEnv()` (see [Configuration](./configuration.md#how-env-is-loaded)).

**Auto-update** (`marketplace/assetAutoUpdate.ts`): `autoUpdateAssets()` re-exports each
repo-scoped asset whose registry version `isNewer` than the recorded installed version.

> **Note on `installer.ts` (`AssetInstaller`).** It writes marketplace assets into
> `.agent-studio/`. It overlaps with `CopilotExporter` (which writes to `.github/`) and is
> constructed in `authGate` but not actively used there. It's a consolidation candidate —
> see [SDD §10](./SDD.md#10-known-gaps--future-work).

---

## 5. Chat participant (`src/participant/`)

- **`agentParticipant.ts`** — `registerParticipant()` creates `@agent-studio` and routes:
  `/skill`/`/agent` → `SkillRunner`; otherwise `WorkflowSelector` picks a phase. Re-checks
  auth (defense in depth). Emits phase-appropriate follow-ups.
- **`workflowSelector.ts`** — maps explicit commands (`/discover|/plan|/implement|/review|
  /workflow <id>`) or trigger phrases to `{ workflow, phase, command }`.
- **`contextInjector.ts`** — `buildSystemPrompt(phase, workflow, assets, max)` composes AI
  identity + phase template + priority-sorted instructions + available skills; plus a
  phase header.
- **`phaseRunner.ts`** — rebuilds chat history, streams the model response via the invoker,
  returns result metadata (drives follow-ups).
- **`skillRunner.ts`** — `/skill <id>` (fills `userPromptTemplate`, adds `bestPractices`)
  and `/agent <id>` (adopts the persona for the turn).
- **`agentInvoker.ts`** — selects a Copilot model (`vscode.lm`) and streams text chunks.
- **`prompts/`** — the discovery/planning/implementation phase templates.

---

## 6. Inspector (`src/inspector/`)

- **`inspectorProvider.ts`** — `InspectorProvider implements TreeDataProvider`. Root →
  marketplace groups + Plugins + MCP; group → asset-type categories; category → asset
  nodes. `refresh()` fires the change event.
- **`inspectorTreeItem.ts`** — node classes: `MarketplaceGroupNode` (status icon),
  `CategoryNode` (per type, opens the marketplace pre-filtered), `AssetNode`
  (Installed/Available icon by scope), `InstalledPluginNode`, `InstalledMcpNode`, and the
  empty-state nodes.
- **`inspectorCommands.ts`** — `refreshInspector`, `enableAsset`/`disableAsset` (via
  `ScopeService` + `CopilotExporter`), `previewAsset` (opens YAML as markdown),
  `injectAsset` (copies the `@agent-studio /skill|/agent <id>` command to the clipboard).

---

## 7. Webview host & protocol (`src/marketplace/marketplacePanel.ts`, `src/shared/protocol.ts`, `webview-ui/`)

Covered in depth in **[Message Protocol](./message-protocol.md)**. In short:
`MarketplacePanel` serves the HTML shell (CSP nonce + `dist/marketplace-webview.js`),
handles `WebviewMessage`s and posts `HostMessage`s — fully typed, zero `as any`. The React
app under `webview-ui/` is feature-driven (`features/*` reducer hooks + components;
`platform/` for the `acquireVsCodeApi` bridge).

---

## 8. MCP & plugins (`src/marketplace/mcpInstaller.ts`, `pluginRegistry.ts`, `pluginTypes.ts`)

- **`mcpInstaller.ts`** — `McpInstaller` installs from a built-in catalog (filesystem,
  github, postgres, brave-search, memory, sequential-thinking, puppeteer, slack, context7,
  linear) into `.vscode/mcp.json`; `isInstalled`, `getInstalled`.
- **`pluginRegistry.ts`** — `PluginRegistry` aggregates Copilot CLI plugin marketplaces
  (default + custom), `install()` via a terminal `copilot plugin install`, tracks installs
  in `workspaceState`, fires `onDidChange`.
- **`pluginTypes.ts`** — plugin manifest/marketplace/source/record types, `PluginType`,
  `GeneratedDoc`.

---

## 9. Analytics (`src/analytics/usageSubmitter.ts`)

`submitUsage(analyticsRepo, getToken)` resolves the dev's login (`GET /user`), reads
`data/perf/local/<login>/*.ndjson`, creates a branch, upserts the files, and opens a PR —
numbers only, with the user's session token. Wired to `agentStudio.submitUsage`. See
[The Triad](./the-triad.md#usage--analytics).

---

## 10. Models, constants, utils

- **`models/types.ts`** — `Asset` union + per-type interfaces; `AssetManifest`.
- **`models/validators.ts`** — tolerant zero-dependency YAML → manifest parser.
- **`constants.ts`** — `COMMANDS`, `CONFIG_KEYS`, `ENV`, `VIEW_IDS`, `CONTEXT_KEYS`,
  `ASSET_TYPE_LABELS/ICONS`, `DEFAULT_UPDATE_REPO`.
- **`utils/version.ts`** — `compareVersions`, `isNewer` (semver).
- **`utils/webviewUtils.ts`** — `getNonce` (CSP).

Next: [Extending](./extending.md) · [SDD](./SDD.md) · [Message Protocol](./message-protocol.md)
