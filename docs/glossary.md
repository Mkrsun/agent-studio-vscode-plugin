# Glossary

Every term used across these docs, in one place. First mentions elsewhere link here.

### Agent (asset type)
A persona with a `role`, `systemPrompt`, and `capabilities`. Exported to
`.github/chatmodes/<id>.chatmode.md` (a Copilot custom chat mode). Invoked in chat with
`@agent-studio /agent <id>`.

### Analytics repo (datastore)
The third leg of [the triad](./the-triad.md). Receives per-dev token-usage NDJSON via pull
requests (numbers only). Resolved by `AGENT_STUDIO_ANALYTICS_REPO` → `agentStudio.analyticsRepo`.

### Asset
The unit of distribution: `Skill | Agent | Workflow | Instruction | Hook`. Defined in
`src/models/types.ts`, stored as an `AssetManifest` YAML, listed in `registry.json`.

### AssetManifest
The on-disk YAML wrapper: `{ schemaVersion: '1.0', asset: Asset }`. Parsed by
`src/models/validators.ts`.

### Authenticated surface
Everything registered only after a GitHub session exists (inspector, chat participant,
marketplace, commands). Built by the `AuthenticatedSurface` class in `auth/authGate.ts`.

### AuthSurfaceManager
The class (`auth/authSurfaceManager.ts`) that swaps the sign-in views for the authenticated
surface as auth state changes — replacing what used to be a nested `reconcile` closure.

### Auto-update (per-asset)
A per-asset preference (a checkbox on the card, **off by default**) that lets an installed
asset be re-exported automatically when a newer registry version appears. Stored per-asset
in workspace state (`ScopeService.get/setAutoUpdate`); honored by `autoUpdateAssets()`.

### Bundled files (`bundleFiles`)
Runnable files a skill ships (e.g. the `token-budget` scripts). Embedded into the asset YAML
in the content repo by `build-bundled-assets.mjs`; extracted to the workspace on install.

### Chat participant
`@agent-studio`, registered via `vscode.chat.createChatParticipant` (the `AgentParticipant`
class). Runs workflow phases and explicit `/skill`/`/agent` commands against the Copilot LM.

### Consolidation (flat export)
Because marketplaces are *sources* but a locally-installed asset is just a local asset,
exports are **flat and keyed by the asset's id** — the same id from two sources resolves to
one file (last install wins). Provenance is kept in a `source:` frontmatter key.

### Content repo
The marketplace of assets (`agentic-studio-assets`). Serves `registry.json` + asset YAML
over the GitHub Contents API. Resolved by `AGENT_STUDIO_MARKETPLACES` /
`AGENT_STUDIO_MARKETPLACE_REPO` / the `agentStudio.marketplaces` setting.

### Context key
A VS Code boolean used in `when`-clauses. Agent Studio uses `agentStudio.authenticated`
(show the surface) and `agentStudio.updating` (lock UI during self-update).

### CopilotExporter
The service (`src/services/copilotExporter.ts`) that renders repo-scoped assets into native
Copilot files under `.github/` — one flat file per asset. The bridge from "asset" to
"Copilot uses it."

### `devId` (anonymous metrics id)
A random per-install UUID stored in globalState, used to key submitted metrics. It groups
a developer's own activity for per-dev insights **without** revealing identity — no name,
login, or email is ever recorded. See `src/analytics/identity.ts` and **`agent-studio/v1`**.

### `agent-studio/v1` (metrics schema)
The NDJSON contract the extension produces and the analytics repo consumes — row kinds
`asset` / `usage` / `copilot`, numbers + coarse tags only (anonymous). Documented in the
analytics repo's `metrics/AGENT-STUDIO-SCHEMA.md`; rendered by `agent-studio-insights.mjs`.

### Descriptor (MarketplaceDescriptor)
A configured marketplace: `{ id, label, repo? | localPath?, parent?, children? }`. Resolved
by `MarketplaceService._getDescriptors()` (which flattens `children` into `parent` links).

### `.env`
A gitignored file of `KEY=value` overrides, loaded into `process.env` at activation by
`src/services/dotenv.ts`. Real shell env wins over it. See [Configuration](./configuration.md).

### Flat layout
The `.github/{prompts,chatmodes,instructions}/<id>.*` export structure — VS Code's default
discovery locations, no per-marketplace subfolders, no monolithic `copilot-instructions.md`.

### Hierarchy (marketplace)
Nesting of marketplaces for display: a parent group (e.g. "Regional") containing child
marketplaces (each its own repo). Declared via `children` in `agentStudio.marketplaces`;
rendered nested in the Inspector. A parent with no `repo` is a pure grouping node.

### Hook (asset type)
A guardrail: `{ trigger, condition?, action }` (e.g. warn before reading a huge file).
Exported as its own always-on instruction file (`applyTo: '**'`).

### Host
The extension running in the VS Code **extension host** (Node). All of `src/`. Contrast
with **Webview**.

### Instruction (asset type)
Always-on guidance with a `scope`, `priority`, and `content`. Exported to
`.github/instructions/<id>.instructions.md` with an `applyTo` glob derived from its scope
(global → `**`).

### Inspector
The sidebar `TreeView` (`agentStudio.inspector`) that navigates (possibly hierarchical)
marketplaces → asset types → assets, plus Plugins and MCP. Code in `src/inspector/`.

### Marketplace
A source of assets — a GitHub `repo` or a dev `localPath`. The extension can have several
configured at once, optionally nested (see **Hierarchy**).

### MarketplaceClient
The only component that fetches content (`src/marketplace/marketplaceClient.ts`): GitHub
Contents API + local fs, with caching and typed error statuses.

### MCP (Model Context Protocol) server
An external tool server. Agent Studio installs definitions from a built-in catalog into
`.vscode/mcp.json` (`src/marketplace/mcpInstaller.ts`).

### NDJSON
Newline-delimited JSON. The format of usage rows (`copilot-tokens/v1`) the analytics layer
produces and submits.

### Org-gating
Optional access control requiring active membership in a configured GitHub org. Feature flag
`agentStudio.auth.requireOrgMembership` (default **false**); orgs from
`AGENT_STUDIO_REQUIRED_ORGS` → `agentStudio.auth.requiredGitHubOrgs`.

### Output channel ("Agent Studio" / logs)
The log surface created by `services/logger.ts` and revealed by `Agent Studio: Show Logs`.
Records activation, `.env`, marketplace fetches, panel open, and relayed webview errors.

### Phase
A stage of a workflow: discovery → planning → implementation → review. Selected by
`workflowSelector.ts`; prompts in `participant/prompts/`.

### Plugin (Copilot CLI plugin)
A package installed via the Copilot CLI (`copilot plugin install`). Surfaced and tracked by
`PluginRegistry`; **not** executed by the extension. Distinct from an Agent Studio asset.

### Protocol (`protocol.ts`)
The typed `HostMessage`/`WebviewMessage` union — the single contract between the extension
host and the React webview. See [Message Protocol](./message-protocol.md).

### registry.json
The content repo's index: `schemaVersion`, `marketplace`, `assets[]` (each with a `path`),
`plugins[]`, `mcpServers[]`. The tool⇄content contract. See [The Triad](./the-triad.md#registryjson-contract).

### Scope (asset scope)
`session` (in-memory, chat-only), `repo` (persisted, exported to `.github/`), or `disabled`.
Managed by `ScopeService`.

### Self-update
The extension upgrading itself from the update repo's GitHub Releases
(`enforceLatestVersion`). See [Release & Self-Update](./release-and-self-update.md).

### Skill (asset type)
A reusable prompt with `systemPrompt`, optional `userPromptTemplate`, `bestPractices`.
Exported to `.github/prompts/<id>.prompt.md`. Invoked with `@agent-studio /skill <id>`.

### `source` (frontmatter)
A frontmatter key written into exported instruction/hook files recording the marketplace an
asset came from — provenance that survives flat consolidation. VS Code ignores it.

### Triad
The three isolated repos: tool (`agent-studio-vscode-plugin`), content
(`agentic-studio-assets`), analytics (`…-analytics`). See [The Triad](./the-triad.md).

### Update repo
The repo whose GitHub Releases provide the extension's `.vsix`. Resolved by
`AGENT_STUDIO_UPDATE_REPO` → `agentStudio.extensionUpdateRepo` → default.

### `.vsix`
The packaged extension artifact produced by `vsce package`. Installed via
`code --install-extension` or the Extensions panel.

### Webview
The marketplace UI: a sandboxed React app in `webview-ui/`. No Node, no `vscode.*`, no
network — only `postMessage` typed by the protocol. Contrast with **Host**.

### Workflow (asset type)
A multi-phase recipe with `phases`, `triggerPhrases`, and an `entryPhase`. Exported to
`.github/prompts/<id>.prompt.md` and drives the chat participant's phases.

### `.agent-studio/`
The workspace folder where workspace-local assets (and bundled skill files) are installed.
Configurable via `agentStudio.workspaceAssetsFolder`.
