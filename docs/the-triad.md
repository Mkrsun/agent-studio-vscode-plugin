# The Triad — Tool ↔ Content ↔ Analytics

Agent Studio is three deliberately **isolated** repositories. This page explains what each
is, how they connect, and the exact contracts and data flows between them.

```
┌────────────────────────────┐   ① fetch registry.json + asset YAML    ┌──────────────────────────┐
│  agent-studio-vscode-plugin│ ───────────────────────────────────────▶│  agentic-studio-assets   │
│        (the TOOL)          │     GitHub Contents API (read)           │     (the CONTENT)        │
│                            │ ◀───────────────────────────────────────│                          │
│                            │                                          └──────────────────────────┘
│                            │   ② submit usage PR (numbers only)       ┌──────────────────────────┐
│                            │ ───────────────────────────────────────▶│  …-analytics (DATASTORE) │
│                            │     GitHub REST (branch + PUT + PR)       └──────────────────────────┘
│                            │   ③ self-update from Releases            ┌──────────────────────────┐
│                            │ ◀───────────────────────────────────────│  update repo (Releases)  │
└────────────────────────────┘                                          └──────────────────────────┘
```

## Why three repos?

| Concern | Tool | Content | Analytics |
|---------|------|---------|-----------|
| Change cadence | Monthly releases | Daily/weekly | Continuous (per dev) |
| Sensitivity | Code | Prompts/personas | Usage numbers |
| Permissions | Maintainers | Asset authors | Org-wide read, gated write |
| Audit | Release notes | `registry.yml` CI | PR history |

Isolation lets each evolve and be permissioned independently. The **tool is the most
expensive to change** (published, versioned, installed), so the _content contract_
(`registry.json`) is kept stable and the tool adapts to content — never the reverse.

---

## ① Tool → Content

### What the tool fetches

The tool is **path-driven**. It fetches one `registry.json`, then each asset by its
declared `path`. It does **not** assume any folder layout — `generate-registry.mjs` is a
dev convenience, never used at runtime.

```
GET /repos/<owner>/<repo>/contents/registry.json          (the index)
GET /repos/<owner>/<repo>/contents/<asset.path>           (each asset YAML, on demand)
```

- Header `Accept: application/vnd.github.raw+json` → raw file body.
- `Authorization: Bearer <token>` from the user's GitHub session → **private repos work**.
- 8-second timeout; 1-hour in-memory cache per marketplace.
- Code: `src/marketplace/marketplaceClient.ts`.

### registry.json contract

The content repo MUST serve a `registry.json` shaped like `MarketplaceRegistryJson`
(`src/marketplace/marketplaceTypes.ts`):

```json
{
  "schemaVersion": "1.0",
  "marketplace": { "id": "agentic-studio-assets", "name": "Agentic Studio Assets", "updatedAt": "2026-06-02T20:08:07.157Z" },
  "assets": [
    {
      "id": "context-pruner",
      "type": "agent",
      "name": "Context Pruner",
      "version": "1.0.0",
      "description": "…",
      "tags": ["context", "summary", "token-optimization"],
      "path": "assets/agents/context-pruner.yaml"
    }
  ],
  "plugins": [],
  "mcpServers": []
}
```

**Validation:** the client hard-checks `schemaVersion` and that `assets` is an array.
Everything else is permissive. The only field that must resolve to a real file is `path`.

### Asset YAML shape

Each asset file is an `AssetManifest`:

```yaml
schemaVersion: "1.0"
asset:
  id: "token-economy"
  name: "Token Economy"
  type: "instruction"          # skill | agent | workflow | instruction | hook
  version: "1.0.0"
  description: "Always-on cost doctrine — read narrow, act cheap, keep context lean."
  tags: ["token-optimization", "cost", "context"]
  enabled: "enabled"
  # …type-specific fields (systemPrompt for skills/agents, content for instructions,
  #   phases for workflows, trigger/condition/action for hooks)…
```

Parsed by `src/models/validators.ts` (a tolerant, zero-dep YAML reader). Type-specific
fields are defined in `src/models/types.ts`.

### Bundled-file assets

A skill can ship runnable files (e.g. the `token-budget` skill bundles `otel-tokens.mjs`,
`project-tokens.mjs`, `submit-usage.mjs`, config templates). In the content repo these
live under `assets/skills/<id>/files/` and are embedded into the YAML's `bundleFiles[]` by
`scripts/build-bundled-assets.mjs`. When installed, the tool extracts them into the
workspace.

### Content-repo CI

`agentic-studio-assets/.github/workflows/registry.yml` gates every change:
1. **Rebuild** bundled assets and self-verify the round-trip.
2. **Validate** by regenerating `registry.json` (required fields, valid types, unique IDs).
3. **Staleness** check (`git diff --exit-code`) so a forgotten regenerate fails CI.

---

## ② Tool → Analytics

The extension gathers metrics **automatically and anonymously** post-install (auto /
opt-out) and ships them to the analytics repo — no Actions, no `gh`, no names. Code:
`src/analytics/{identity,metricsCollector,analyticsService,usageSubmitter,metrics}.ts`.

### What is collected (numbers + coarse tags only)

`AnalyticsService.start()` resolves an **anonymous `devId`** (random per-install UUID — no
name/login/email) + **country** (from VS Code locale + IDE timezone), then `MetricsCollector`
appends NDJSON rows to the extension's global storage. Three row kinds:

- **`asset`** — install / uninstall / update / **invoke** → popularity & most-used.
- **`usage`** — the `@agent-studio` participant's own LM calls: model, input/output tokens,
  duration, asset, command, language → **efficiency**.
- **`copilot`** — **TRUE Copilot tokens**, imported from Copilot's OpenTelemetry export
  (the extension auto-enables `github.copilot.chat.otel.outfile`, content capture OFF),
  read incrementally by byte offset so nothing is double-counted.

Full field-by-field contract: the analytics repo's
[`AGENT-STUDIO-SCHEMA.md`](https://github.com/Mkrsun/meta-repo-latam-ai-intelligence-ecosystem-analytics/blob/main/analytics/metrics/AGENT-STUDIO-SCHEMA.md)
(schema `agent-studio/v1`).

### How it's submitted (auto)

```
(daily, throttled)  collect globalStorage perf/<devId>/*.ndjson
  → branch usage/<devId>/<stamp>
  → PUT each file under data/perf/local/<devId>/…
  → POST a pull request to the analytics repo
```

Reuses the user's **GitHub session token** (no PAT). The command
**`Agent Studio: Submit Token Usage to Analytics`** (`agentStudio.submitUsage`) forces an
immediate submit. **Fail-soft:** if `analyticsRepo` is unset or unreachable, collection
continues locally and submission just no-ops/logs — analytics can never break activation.
Controls: `agentStudio.analytics.{enabled,autoSubmit,autoEnableCopilotOtel}` (all default ON).

### What the analytics repo does with it

- **`agent-studio-insights.mjs`** → the leadership dashboard: adoption by country,
  most-popular / most-used assets, least-efficient assets (tokens per run), and tokens by
  model / country / language.
- **`project-tokens.mjs`** → burndown + forecast (quota-exhaustion date).

Both zero-dependency (Node stdlib). The repo *tracks* submitted rows (its
`data/perf/.gitignore` is a committed keep-file, unlike product repos which ignore them).

> **Secondary path:** the `token-budget` skill also ships standalone `otel-tokens.mjs` /
> `submit-usage.mjs` for manual/CI use (login-based, `GITHUB_TOKEN` PAT). The extension's
> automatic pipeline above is anonymous (`devId`) and needs no PAT.

### Usage row schema (`agent-studio/v1`)

```json
{ "schema": "agent-studio/v1", "kind": "usage", "devId": "a1b2…", "country": "CL",
  "model": "gpt-4o", "assetId": "code-review", "assetType": "skill", "languageId": "typescript",
  "inputTokens": 1200, "outputTokens": 900, "durationMs": 3000, "date": "2026-06-02" }
```

**Anonymous** (devId only) and **never** contains prompt or response content.

---

## ③ Tool ← Update repo

The extension updates itself from the **update repo's** GitHub Releases — see
[Release & Self-Update](./release-and-self-update.md). By convention the update repo is the
tool's own repo, but it is configurable like everything else.

---

## The wiring — which knob points where

All resolve `env → setting → default` (see [Configuration](./configuration.md)):

| Connection | Env var | Setting | Default |
|------------|---------|---------|---------|
| Content (full list) | `AGENT_STUDIO_MARKETPLACES` | `agentStudio.marketplaces` | one entry → `Mkrsun/agentic-studio-assets` |
| Content (single shorthand) | `AGENT_STUDIO_MARKETPLACE_REPO` | — | — |
| Analytics | `AGENT_STUDIO_ANALYTICS_REPO` | `agentStudio.analyticsRepo` | `''` (unset) |
| Update | `AGENT_STUDIO_UPDATE_REPO` | `agentStudio.extensionUpdateRepo` | `Mkrsun/agent-studio-vscode-plugin` |
| Org-gating | `AGENT_STUDIO_REQUIRED_ORGS` | `agentStudio.auth.requiredGitHubOrgs` | `[]` |

## End-to-end picture

```
 Author writes asset YAML ─▶ content repo CI regenerates registry.json
                                         │
   Dev's VS Code ◀── fetch registry + YAML (Contents API) ──┘
        │ install → export to .github/ → Copilot uses it natively
        │
        │ auto, anonymous: collect asset/usage/copilot rows (devId, country)
        ▼ daily PR (raw API)
   analytics repo ─▶ agent-studio-insights.mjs (leadership dashboard)
                  └▶ project-tokens.mjs (burndown + forecast)
```

Next: [Configuration](./configuration.md) · [Subsystems](./subsystems.md) · [SDD](./SDD.md)
