# Software Design Document — Agent Studio

**Status:** Living document · **Audience:** Maintainers · **Scope:** The Agent Studio VS
Code extension and its place in the triad.

This is the authoritative design reference. It explains _what_ the system is, _how_ it is
structured, _why_ it is structured that way, and _what it deliberately does not do_. For
hands-on instructions see the [Development Guide](./development.md); for a file-by-file
tour see [Subsystems](./subsystems.md).

---

## 1. Purpose & scope

### 1.1 Problem

Teams want to standardize how they use GitHub Copilot: shared prompts, agent personas,
multi-step workflows, repo-wide instructions, and guardrails — distributed centrally,
versioned, and measurable, **without** building a bespoke AI runtime or leaking code to
third parties.

### 1.2 Solution

Agent Studio is a VS Code extension that:

1. **Distributes "assets"** (skills, agents, workflows, instructions, hooks) from a
   central **content repo** through a marketplace UI.
2. **Exports installed assets to native Copilot files** under `.github/`, so Copilot uses
   them directly — Agent Studio augments Copilot rather than replacing it.
3. **Provides a chat participant** (`@agent-studio`) that runs multi-phase workflows and
   explicit skill/agent invocations against the VS Code Language Model API (Copilot).
4. **Measures token usage** locally ($0, zero-dependency) and consolidates it into an
   **analytics repo** via pull requests — numbers only, never content.
5. **Updates itself** from GitHub Releases.

### 1.3 Non-goals

- **Not** a replacement LLM runtime. It uses the VS Code Language Model API (Copilot).
- **Not** a telemetry pipeline that captures prompts/responses. Usage data is
  per-(date, model) counts only.
- **Not** multi-tenant SaaS. It is a single-org / single-private-repo tool by default;
  org-gating is an opt-in flag.
- **Not** a general plugin host. Copilot CLI plugins are _surfaced_ and installed via the
  terminal, not executed by the extension.

---

## 2. The triad (system context)

Agent Studio is one of three deliberately **isolated** repositories:

| Repo | Role | Connection |
|------|------|------------|
| `agent-studio-vscode-plugin` (this) | The **tool** | Fetches content; submits usage |
| `agentic-studio-assets` | The **content** marketplace | Serves `registry.json` + asset YAML |
| `…-ecosystem-analytics` | The **analytics** datastore | Receives usage PRs |

The tool never hardcodes the others. Each is resolved through configuration
(`env → setting → default`). See [The Triad](./the-triad.md) for the full data flows and
[Configuration](./configuration.md) for the exact keys.

**Design rationale — why three repos?** Content changes far more often than the tool
(new skills weekly vs. tool releases monthly). Analytics data has a different
sensitivity and retention profile than either. Isolation lets each evolve, be permissioned,
and be audited independently. The tool is published/versioned and therefore the most
expensive to change, so the _content contract_ (`registry.json`) is kept stable and the
tool adapts to content, not the other way around.

---

## 3. Architecture overview

### 3.1 Layered view

```
┌──────────────────────────────────────────────────────────────────────┐
│ Presentation                                                          │
│   • Inspector TreeView (sidebar)     • Marketplace webview (React)    │
│   • Chat participant (@agent-studio) • Sign-in placeholder view       │
├──────────────────────────────────────────────────────────────────────┤
│ Application / commands                                                 │
│   • inspectorCommands  • marketplacePanel handlers                     │
│   • participant phase/skill runners  • usageSubmitter                  │
├──────────────────────────────────────────────────────────────────────┤
│ Domain services                                                        │
│   • AssetLoader   • ScopeService   • CopilotExporter                   │
│   • MarketplaceService • PluginRegistry • McpInstaller                 │
├──────────────────────────────────────────────────────────────────────┤
│ Platform / integration                                                 │
│   • AuthService (GitHub OAuth, org-gating, self-update)               │
│   • MarketplaceClient (GitHub Contents API + local fs)                │
│   • ConfigService (settings + env)   • dotenv loader                   │
├──────────────────────────────────────────────────────────────────────┤
│ Cross-cutting: constants, models/types, shared/protocol, utils        │
└──────────────────────────────────────────────────────────────────────┘
        │                         │                         │
        ▼                         ▼                         ▼
   VS Code APIs            GitHub REST API          VS Code LM API (Copilot)
 (chat, tree, fs,      (contents, releases,         model.sendRequest()
  authentication)       user, org membership)
```

### 3.2 Process & isolation boundaries

- **Extension host (Node):** all of `src/`. Has `process.env`, file system, `vscode.*`.
- **Webview (browser sandbox):** all of `webview-ui/`. **No** Node, **no** `vscode.*`,
  **no** network of its own. It talks to the host **only** through `postMessage`, typed by
  `src/shared/protocol.ts`. This boundary is the most important contract in the codebase —
  see [Message Protocol](./message-protocol.md).
- **GitHub:** reached with raw `fetch` + a bearer token from the user's GitHub session.
  No SDK.

### 3.3 Key design principles

1. **Decouple tool from content.** The tool ships no assets; it fetches them.
2. **Feed Copilot, don't intercept it.** Installing an asset writes native `.github/`
   files; Copilot does the rest.
3. **One source of truth per contract.** `protocol.ts` (host⇄webview), `registry.json`
   (tool⇄content), `models/types.ts` (asset shape).
4. **`env → setting → default` everywhere routable.** Ops can repoint via `.env` with no
   settings edits and no rebuild.
5. **Fail closed on auth, fail soft on content.** No session ⇒ no surface. A marketplace
   that won't load ⇒ a labelled error node, not a crash.
6. **Zero external runtime deps.** React is bundled; everything else is `fetch` + Node
   stdlib + `vscode.*`.

---

## 4. Component model

> Full detail in [Subsystems](./subsystems.md). This section is the design-level summary.

### 4.1 Activation & lifecycle (`extension.ts`, `auth/authSurfaceManager.ts`, `auth/authGate.ts`)

`activate()` reads as a flat sequence of named steps (no nested closures):

1. `initLogger(context)` — bring up the **`Agent Studio` output channel** first, so
   everything after it is logged (command `Agent Studio: Show Logs`).
2. `loadDotEnv(context)` — merge `.env` (workspace folders, then extension dir) into
   `process.env`. Real env always wins. **Must run before any service reads an override.**
3. Dev bypass (`isDevAuthBypass` → `activateWithoutAuth`): in an Extension Development
   Host + `auth.bypassForDev`, register the full surface immediately (never effective in a
   packaged `.vsix`).
4. Create `AuthService`; register the always-on commands (`signIn`, `signOut`,
   `showAuthStatus`, `showLogs`).
5. Hand off to **`AuthSurfaceManager`** — a small state-owning class that holds the
   sign-in views + authenticated-surface disposables and `reconcile`s them on every auth
   state change (toggling the `agentStudio.authenticated` context key). This replaced the
   old nested `reconcile` closure.
6. `registerAuthenticatedSurface()` (the **`AuthenticatedSurface`** class) wires every
   service, the inspector, the chat participant, and all commands, and kicks off
   self-update + asset auto-update. Its `build()` reads as a table of contents; each
   command is a named method.

**Decision:** the surface is built _lazily on authentication_, not at activation, so
unauthenticated users see only the sign-in affordance and no service touches the network
without a token.

### 4.2 Auth & self-update (`auth/`)

`AuthService` owns the GitHub session lifecycle via `vscode.authentication`. Scopes are
`['repo','user:email']`, plus `read:org` **only** when org-gating is enabled. Org-gating
(`auth.requireOrgMembership`, default **false**) checks membership against the resolved
org list (`getRequiredOrgs()`: `env → setting → []`). SSO is detected and surfaced with a
deep link. **Fail-closed:** any validation error denies access.

`updateChecker.enforceLatestVersion()` runs once per day: it reads the latest GitHub
Release of the **update repo** (`AGENT_STUDIO_UPDATE_REPO → setting → default`), compares
versions, and either auto-installs the newer `.vsix` (token-authenticated download, works
for private repos) or shows a dismissible toast. An optional `latest.json` manifest can
force updates or set a `minimumVersion`. The `agentStudio.updating` context key locks the
UI during install. See [Release & Self-Update](./release-and-self-update.md).

### 4.3 Marketplace data layer (`marketplace/marketplaceService.ts`, `marketplaceClient.ts`)

`MarketplaceService` orchestrates _N_ configured marketplaces: seeds them as `loading`,
fetches all in parallel, and exposes `ResolvedMarketplace[]` with a status
(`loading | ready | no-access | unreachable | malformed`). It re-fetches when the
marketplace config changes.

`MarketplaceClient` is the only thing that talks to the content repo: it fetches
`registry.json` and individual asset YAML via the **GitHub Contents API**
(`GET /repos/{repo}/contents/{path}`, `Accept: application/vnd.github.raw+json`, bearer
token, 8s timeout, 1-hour in-memory cache). It also supports a `localPath` source for
dev/test.

**Contract:** the content repo must serve a `registry.json` matching
`MarketplaceRegistryJson` (see [The Triad](./the-triad.md#registryjson-contract)). Each
asset's `path` is fetched verbatim — the tool is **path-driven**, so the content repo's
internal folder layout is free as long as `registry.json` points at real files.

### 4.4 Asset pipeline (`services/assetLoader.ts`, `scopeService.ts`, `copilotExporter.ts`)

The heart of the extension:

- **`AssetLoader`** merges assets from all ready marketplaces (fetched YAML → parsed
  manifest) with any workspace assets under `.agent-studio/`, keyed by `marketplaceId:id`.
- **`ScopeService`** assigns each asset a scope:
  - `session` — in-memory only; injected into chat context; **not** exported.
  - `repo` — persisted in workspace settings; **exported** to `.github/`; survives restart.
  - `disabled` — neither injected nor exported.
  It also records the **installed version** and the **per-asset auto-update flag**
  (off by default) for each asset.
- **`CopilotExporter`** renders repo-scoped assets into native Copilot files — **one
  file per asset**, named by the asset's (globally-unique) id and **consolidated** into
  VS Code's default flat locations (no per-marketplace folders, no monolithic
  `copilot-instructions.md`):

  | Asset type | Exported file | Copilot feature |
  |------------|---------------|-----------------|
  | skill | `.github/prompts/<id>.prompt.md` | reusable prompt |
  | workflow | `.github/prompts/<id>.prompt.md` | guided prompt |
  | agent | `.github/chatmodes/<id>.chatmode.md` | custom chat mode |
  | instruction | `.github/instructions/<id>.instructions.md` | `applyTo`-injected |
  | hook | `.github/instructions/<id>.instructions.md` | always-on (`applyTo: '**'`) |

  Marketplaces are *sources*; a locally-installed asset is just a local asset, so the
  same id from two sources consolidates to one file (last install wins) — provenance is
  kept in a `source:` frontmatter key. A recursive **reconcile** removes our orphaned
  generated files (legacy `as-*`, old per-marketplace folders, the monolith).
- **`assetAutoUpdate.autoUpdateAssets()`** re-exports a repo-scoped asset when its
  per-asset auto-update flag is on AND the registry version is newer than the recorded
  installed version (on load and on catalog refresh). Nothing auto-updates by default.

**Decision — two-level scoping.** `session` vs. `repo` separates "try it in this chat"
from "commit it to the repo for the whole team." Only `repo` touches the file system, so
experimentation is side-effect-free.

### 4.5 Chat participant (`participant/`)

`registerParticipant()` creates `@agent-studio`. A request is routed by `WorkflowSelector`:
explicit `/skill <id>` and `/agent <id>` go to `SkillRunner`; `/discover`, `/plan`,
`/implement`, `/review` (or a workflow trigger phrase) select a workflow **phase**.
`ContextInjector` builds the system prompt from the AI identity + phase template + active
instructions (priority-sorted) + available skills (capped by `maxContextAssets`).
`PhaseRunner`/`AgentInvoker` stream the response from the Copilot model via
`vscode.lm`. Follow-up suggestions are emitted per phase.

**Defense in depth:** the handler re-checks auth even though the surface only registers
when authenticated.

### 4.6 Inspector (`inspector/`)

`InspectorProvider` is a `TreeDataProvider` rendering: marketplace groups → asset-type
categories → asset nodes, plus Plugins and MCP sections. **Marketplaces can be
hierarchical** — a parent group (e.g. "Regional") nests child marketplaces (each its own
repo); the root shows parentless groups, and a group shows its child groups then its own
categories. Node icons reflect scope/status. Context-menu commands (`enable`, `disable`,
`preview`, `inject`) are named top-level functions (`inspectorCommands.ts`) operating
through `ScopeService` + `CopilotExporter`, refreshing the tree via its change event.

### 4.7 Webview host + protocol (`marketplace/marketplacePanel.ts`, `shared/protocol.ts`, `webview-ui/`)

`MarketplacePanel` hosts the React app (serves an HTML shell with a CSP nonce loading
`dist/marketplace-webview.js`). All messaging is typed by the `HostMessage` /
`WebviewMessage` unions in `protocol.ts`, which the webview imports via
`webview-ui/protocol.ts`. The webview is feature-driven (`features/{assets,plugins,mcp,
extensions}` each with a `use*` reducer hook + components; `platform/` for the
`acquireVsCodeApi` bridge). See [Message Protocol](./message-protocol.md).

**Asset-card states.** A card is either *not installed* → **Install**, or *installed* →
**Update** (only when a newer registry version exists) + **Uninstall** (danger), plus a
per-asset **Auto-update** checkbox (off by default; `AssetState.autoUpdate` ↔
`marketplace:setAutoUpdate`). Preview is always available.

**Error surfacing.** The HTML bootstrap acquires the VS Code API once (shared on
`window.__vscodeApi`) and installs global `error`/`unhandledrejection` handlers that
render the failure into the panel and relay it (`webview:error`) to the output channel —
so a load-time bundle throw is diagnosable instead of a silent blank panel.

### 4.8 MCP & plugins (`marketplace/mcpInstaller.ts`, `pluginRegistry.ts`)

`McpInstaller` writes MCP server definitions into `.vscode/mcp.json` from a built-in
catalog. `PluginRegistry` aggregates Copilot CLI plugin marketplaces and installs via a
terminal-run `copilot plugin install`, tracking installs in workspace state. Both are
surfaced as marketplace tabs and inspector sections.

### 4.9 Analytics (`analytics/usageSubmitter.ts`)

The `agentStudio.submitUsage` command reads local `data/perf/local/<login>/*.ndjson`,
opens a branch on the **analytics repo**, upserts the files, and opens a PR — reusing the
user's GitHub session token. Numbers only. Mirrors the content repo's `submit-usage.mjs`
but without a separate PAT. See [The Triad](./the-triad.md#usage--analytics).

---

## 5. Data design

### 5.1 Asset model (`models/types.ts`)

`Asset = Skill | Agent | Workflow | Instruction | Hook`, each extending `AssetBase`
(`id, name, type, version, description, tags?, source, enabled, marketplaceId?`). Wrapped
on disk as `AssetManifest { schemaVersion: '1.0', asset: Asset }` in YAML. Parsed by
`models/validators.ts` (a tolerant, zero-dependency YAML reader — no `js-yaml`).

### 5.2 Registry contract (`marketplace/marketplaceTypes.ts`)

```ts
interface MarketplaceRegistryJson {
  schemaVersion: '1.0';
  marketplace: { id: string; name: string; updatedAt: string };
  assets: MarketplaceAssetRef[];   // each: { id, type, name, version, description, tags[], path }
  plugins: unknown[];
  mcpServers: unknown[];
}
```

The client hard-validates `schemaVersion` + `assets` is an array; everything else is
permissive. `path` is the only field that must resolve to a real file in the content repo.

### 5.3 Scope & version persistence

- Repo scope → workspace settings (survives restart, lives with the repo).
- Session scope → in-memory (cleared on restart).
- Installed version → `context.workspaceState` (drives auto-update comparisons via
  `utils/version.isNewer`).

### 5.4 Usage rows (analytics)

NDJSON, schema `copilot-tokens/v1`: `{ login, date, model, source, confidence, requests,
inputTokens, outputTokens, totalTokens }`. **No prompt/response content, ever.**

---

## 6. Key sequences

### 6.1 Boot → authenticated surface

```
activate
  → loadDotEnv
  → AuthService.initialize (silent session)
  → reconcile(authenticated)
      → registerAuthenticatedSurface
          → enforceLatestVersion (self-update, throttled)
          → MarketplaceService.initialize (parallel registry fetches)
          → AssetLoader.loadAll  → autoUpdateAssets
          → InspectorProvider + chat participant + commands
```

### 6.2 Install an asset (from the marketplace webview)

```
webview: click Install → post {marketplace:install, assetId}
host: _handle
  → ScopeService.setScope(id,'repo')
  → CopilotExporter.exportOne(id, repoScopedIds)   → writes .github/…
  → ScopeService.setInstalledVersion(id, version)
  → post {marketplace:assetState, …}               → webview shows "Installed"
```

### 6.3 Submit usage

```
command agentStudio.submitUsage
  → resolveLogin (GET /user)
  → collect data/perf/local/<login>/*.ndjson
  → create branch → PUT files → POST pull request   (analytics repo, session token)
  → toast “Open PR”
```

### 6.4 Self-update

```
enforceLatestVersion (≤ once/day)
  → GET /repos/<updateRepo>/releases/latest (+ optional latest.json)
  → if newer or below minimum:
       download .vsix (token) → installExtension → set agentStudio.updating → reload prompt
     else if newer & auto-update off: dismissible toast
```

---

## 7. Cross-cutting concerns

- **Security & privacy.** Token from the user's GitHub session, never persisted in
  plaintext by us. Org-gating optional. Usage = numbers only. No third-party network.
- **Error handling.** Network calls are timed out and mapped to typed statuses; the UI
  shows labelled error/loading states. Auth fails closed; content fails soft.
- **Performance.** Registry/asset fetches are cached (1h) and parallelized; the webview
  streams catalogs progressively; search is debounced (250ms).
- **Configurability.** See [Configuration](./configuration.md). Everything routable is
  `env → setting → default`.
- **Observability.** The **`Agent Studio` output channel** (`services/logger.ts`,
  `Agent Studio: Show Logs`) logs activation, `.env`, per-marketplace fetch outcomes,
  panel open, and relayed webview errors. User-facing toasts report command outcomes; the
  analytics layer is the longitudinal signal.

---

## 8. Build & packaging (design intent)

Two esbuild bundles: `dist/extension.js` (CJS, Node, `vscode` external) and
`dist/marketplace-webview.js` (IIFE, browser, JSX automatic). Two `tsconfig`s
(extension + webview) typecheck independently. `.vscodeignore` ships **only** the bundled
output + runtime media — never source or maps. `vsce` requires a PNG icon and a
`repository` field (both present). See [Development](./development.md) and
[Release](./release-and-self-update.md).

---

## 9. Design decisions & trade-offs (ADR-lite)

| # | Decision | Why | Trade-off |
|---|----------|-----|-----------|
| 1 | Three isolated repos | Independent cadence, permissions, audit | More moving parts to wire |
| 2 | Export to `.github/` instead of intercepting Copilot | Native, future-proof, no API hacks | Assets only as powerful as Copilot's file features |
| 3 | Path-driven registry | Content repo layout stays free | Registry must be regenerated when assets move |
| 4 | `env → setting → default` resolution | Ops repoint via `.env`, no rebuild | Two config sources to reason about |
| 5 | Org-gating as a flag, OFF by default | Works for a single private repo out of the box | Enterprises must opt in explicitly |
| 6 | Raw `fetch`, no Octokit/`gh` | Zero deps, smaller bundle, fewer CVEs | We hand-roll pagination/headers |
| 7 | Typed `protocol.ts` as the single host⇄webview contract | Compile-time safety across the boundary | Every new message needs a union entry on both sides |
| 8 | React webview, esbuild (not webpack) | Fast builds, simple config | No webpack ecosystem niceties |
| 9 | Two-level scoping (session/repo) | Risk-free experimentation | Slightly more state to track |
| 10 | Self-update via GitHub Releases | Works for private repos with the same token | Requires release discipline + manifest |
| 11 | Flat export, consolidated by asset id | Marketplaces are sources; a local asset is a local asset. VS Code's default locations = most reliable discovery | Same id across sources collapses to one file (intended) |
| 12 | Per-asset auto-update, OFF by default | Updates are opt-in and explicit; no surprise rewrites | Each asset must be toggled on |
| 13 | No nested functions (named fns / small classes) | Readability + testability; no callback-hell | A little more surface area (more named units) |

---

## 10. Known gaps & future work

- **No automated test harness yet.** Highest-value first targets: `utils/version`,
  `ScopeService`, `parseMarketplacesEnv`, the `protocol.ts` DTOs, and `CopilotExporter`
  rendering. (`test` script + `@vscode/test-cli` are present but unconfigured.)
- **`mcp-server` is not a first-class registry asset type** — it lives in a hardcoded
  catalog rather than `registry.json`.
- **`installer.ts` (`AssetInstaller`)** overlaps with `CopilotExporter`; still used by
  `marketplacePanel` but a candidate for consolidation (the dead `authGate` construction
  was removed).
- **`mcp-server` / Copilot-extension assets** aren't yet first-class registry types.

See [Extending](./extending.md) before picking any of these up.

---

## 11. Glossary

See the dedicated [Glossary](./glossary.md).
