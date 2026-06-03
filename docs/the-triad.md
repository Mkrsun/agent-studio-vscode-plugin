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

### How usage is produced (local, $0)

The `token-budget` skill (installed from the content repo) ships scripts that read VS Code
Copilot's OpenTelemetry export and write **per-(date, model)** counts as NDJSON:

```
~/.copilot-otel/usage.jsonl   ──otel-tokens.mjs──▶   data/perf/local/<login>/<YYYY-MM>.ndjson
```

These rows are `confidence: "measured"` (true tokens) or `"estimate"` (the zero-dep
approximator). They are **gitignored** in product repos (per-dev, regenerable).

### How usage is submitted

The extension command **`Agent Studio: Submit Token Usage to Analytics`**
(`agentStudio.submitUsage`, code in `src/analytics/usageSubmitter.ts`):

```
resolve login (GET /user)
  → read data/perf/local/<login>/*.ndjson
  → create branch usage/<login>/<stamp>
  → PUT each file under data/perf/local/<login>/…
  → POST a pull request to the analytics repo
```

It reuses the user's **GitHub session token** — no separate PAT. The PR body states the
data is numbers-only. The analytics repo commits these (its `data/perf/.gitignore` is a
committed keep-file, so unlike product repos it *tracks* submitted rows).

> The content repo also ships a standalone `submit-usage.mjs` for CI/headless use (it
> wants a `GITHUB_TOKEN` PAT). The extension command and the script are twins; use whichever
> fits.

### What the analytics repo does with it

`project-tokens.mjs` produces a **burndown + forecast**: it sums the current billing
period, computes a trailing burn rate, and projects the quota-exhaustion date. Other
scripts add git-only quality proxies and optional PR cycle-time. All zero-dependency
(bash + git + Node stdlib).

### Usage row schema (`copilot-tokens/v1`)

```json
{ "schema": "copilot-tokens/v1", "login": "manu", "date": "2026-06-02",
  "model": "gpt-4o", "source": "otel", "confidence": "measured",
  "requests": 42, "inputTokens": 150000, "outputTokens": 50000, "totalTokens": 200000 }
```

**Never** contains prompt or response content.

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
        │ work happens; otel-tokens.mjs writes local NDJSON
        ▼
   Submit Usage command ─▶ PR to analytics repo ─▶ project-tokens.mjs forecast
```

Next: [Configuration](./configuration.md) · [Subsystems](./subsystems.md) · [SDD](./SDD.md)
