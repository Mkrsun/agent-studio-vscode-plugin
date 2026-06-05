# Configuration & `.env`

Everything routable in Agent Studio resolves in **one order**:

```
process.env (including .env)   →   VS Code setting   →   built-in default
```

Environment wins so that ops/CI can repoint repos and orgs through a gitignored `.env`
with **no settings edits and no rebuild**. This page is the exhaustive reference.

## How `.env` is loaded

VS Code's extension host only sees the environment it was launched with — it does **not**
read a project `.env`. So `activate()` runs `loadDotEnv(context)` first
(`src/services/dotenv.ts`):

- Reads `.env` from **each workspace folder root**, then the **extension install dir**.
- Parses `KEY=value`, `export KEY=…`, `#` comments, blank lines, and single/double quotes
  (`\n` unescaped inside double quotes).
- **Never clobbers** an already-set value — a real shell/CI env var beats the file, and an
  earlier file beats a later one.

`.env` is gitignored. Copy the template to start:

```bash
cp .env.example .env
```

## Environment variables (the routable knobs)

| Env var | Controls | Format / example |
|---------|----------|------------------|
| `AGENT_STUDIO_MARKETPLACES` | The **full** content marketplace list | `id:Label:owner/repo, …` or a JSON array |
| `AGENT_STUDIO_MARKETPLACE_REPO` | A **single** content repo (shorthand) | `Mkrsun/agentic-studio-assets` |
| `AGENT_STUDIO_ANALYTICS_REPO` | Where `Submit Usage` opens its PR | `Owner/analytics-repo` |
| `AGENT_STUDIO_UPDATE_REPO` | GitHub Releases source for self-update | `Mkrsun/agent-studio-vscode-plugin` |
| `AGENT_STUDIO_REQUIRED_ORGS` | Orgs that grant access (when gating ON) | `Org-A,Org-B` (comma-separated) |

### `AGENT_STUDIO_MARKETPLACES` formats

Parsed by `parseMarketplacesEnv()` (`src/services/configService.ts`). Two accepted forms:

**Comma-list** (human-friendly):

```bash
AGENT_STUDIO_MARKETPLACES=regional:Regional LatAm:Org/regional-marketplace,chile:Chile:Org/chile-marketplace
```

Each entry is `id:Label:owner/repo`, where:
- `owner/repo` alone → `id` and `Label` derived from the repo name.
- `id:owner/repo` → `Label` defaults to `id`.
- `id:Label:owner/repo` → all explicit.
- Entries without a valid `owner/repo` are dropped.

**JSON array** (precise):

```bash
AGENT_STUDIO_MARKETPLACES=[{"id":"chile","label":"Chile","repo":"Org/chile-marketplace"}]
```

**Precedence within content config:** `AGENT_STUDIO_MARKETPLACES` (full list) →
`AGENT_STUDIO_MARKETPLACE_REPO` (single) → `agentStudio.marketplaces` setting. See
`MarketplaceService._getDescriptors()`.

## VS Code settings

All under the `agentStudio.*` namespace (declared in `package.json` →
`contributes.configuration`).

### Repos & updates

| Setting | Default | Env override | Notes |
|---------|---------|--------------|-------|
| `agentStudio.marketplaces` | `[{ id: "agentic-studio", label: "Agentic Studio Assets", repo: "Mkrsun/agentic-studio-assets" }]` | `AGENT_STUDIO_MARKETPLACES` / `_MARKETPLACE_REPO` | The content marketplace list |
| `agentStudio.analyticsRepo` | `''` | `AGENT_STUDIO_ANALYTICS_REPO` | Usage PR target |
| `agentStudio.extensionUpdateRepo` | `Mkrsun/agent-studio-vscode-plugin` | `AGENT_STUDIO_UPDATE_REPO` | Self-update source |
| `agentStudio.extensionUpdateManifestPath` | `''` | — | Optional `latest.json` path (forceUpdate/minimumVersion) |
| `agentStudio.extensionAutoUpdate` | `true` | — | Auto-install newer `.vsix` at startup |
| `agentStudio.assetAutoUpdate` | `true` | — | Re-export installed assets when a newer registry version appears |

### Auth & org-gating

| Setting | Default | Env override | Notes |
|---------|---------|--------------|-------|
| `agentStudio.auth.requireOrgMembership` | `false` | — | **Feature flag.** OFF = any GitHub user passes. ON also requests `read:org`. |
| `agentStudio.auth.requiredGitHubOrgs` | `[]` | `AGENT_STUDIO_REQUIRED_ORGS` | Orgs that grant access (only enforced when the flag is ON) |
| `agentStudio.auth.bypassForDev` | `false` | — | DEV ONLY; effective only in an Extension Development Host |

### Assets & chat

| Setting | Default | Notes |
|---------|---------|-------|
| `agentStudio.workspaceAssetsFolder` | `.agent-studio` | Where workspace assets live |
| `agentStudio.enabledAssets` | `[]` | Asset IDs forced enabled |
| `agentStudio.disabledAssets` | `[]` | Asset IDs forced disabled |
| `agentStudio.autoInjectEnabledAssets` | `true` | Inject active assets into chat context |
| `agentStudio.maxContextAssets` | `5` | Cap on assets injected per chat turn |
| `agentStudio.defaultWorkflow` | `full-feature-workflow` | Workflow used when none specified |

> The exact list lives in `package.json`; `src/constants.ts` maps each to a `CONFIG_KEYS`
> constant and `src/services/configService.ts` exposes a typed getter.

## Marketplace hierarchy

Marketplaces are *sources*, and they can be **nested** so the Inspector groups them. A
parent group can contain child marketplaces — each its own independent GitHub repo — and
the parent may also have its own `repo` (or be a pure grouping node with no `repo`):

```jsonc
"agentStudio.marketplaces": [
  {
    "id": "regional", "label": "Regional", "repo": "Org/regional-marketplace",
    "children": [
      { "id": "chile",     "label": "Chile",     "repo": "Org/chile-marketplace" },
      { "id": "brasil",    "label": "Brasil",    "repo": "Org/brasil-marketplace" },
      { "id": "argentina", "label": "Argentina", "repo": "Org/argentina-marketplace" },
      { "id": "mexico",    "label": "Mexico",    "repo": "Org/mexico-marketplace" }
    ]
  }
]
```

The Inspector renders `Regional → [Chile, Brasil, Argentina, Mexico]` plus Regional's own
assets. `children` is flattened internally into sibling descriptors carrying `parent`
(`MarketplaceService._getDescriptors` → `flattenMarketplaces`); any depth is supported.

> Note: installed assets are **not** filed by marketplace — sources differ, but a locally
> installed asset is just a local asset. Installs consolidate into the flat
> `.github/{prompts,chatmodes,instructions}` set (see [SDD §4.4](./SDD.md)).

## Local marketplaces

For developing assets + tool together without GitHub, a marketplace descriptor can use
`localPath` (absolute) instead of `repo`. The `MarketplaceClient` reads `registry.json`
and asset files straight from disk:

```jsonc
"agentStudio.marketplaces": [
  { "id": "dev", "label": "Local Dev", "localPath": "/Users/me/projects/agentic-studio-assets" }
]
```

`localPath` sources are intended for dev/test only.

## Worked examples

**Point everything at one private content repo via `.env`:**

```bash
AGENT_STUDIO_MARKETPLACE_REPO=Acme/agentic-studio-assets
AGENT_STUDIO_ANALYTICS_REPO=Acme/ai-analytics
AGENT_STUDIO_UPDATE_REPO=Acme/agent-studio-vscode-plugin
```

**Enable enterprise org-gating for two orgs:**

```jsonc
// settings.json
"agentStudio.auth.requireOrgMembership": true
```
```bash
# .env (or real env)
AGENT_STUDIO_REQUIRED_ORGS=Acme-Global,Acme-Labs
```

**Several regional marketplaces:**

```bash
AGENT_STUDIO_MARKETPLACES=regional:Regional:Acme/regional-marketplace,chile:Chile:Acme/chile-marketplace,brasil:Brasil:Acme/brasil-marketplace
```

Next: [The Triad](./the-triad.md) · [Release & Self-Update](./release-and-self-update.md)
