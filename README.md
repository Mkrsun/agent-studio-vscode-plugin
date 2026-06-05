# Agent Studio — VS Code Extension

> A GitHub Copilot **agent framework** for the enterprise: a marketplace web UI, an
> asset inspector (sidebar navigator), and multi-phase chat workflows — all driven
> by a decoupled content repo, with a $0 / zero-dependency analytics layer.

Agent Studio is the **tool**. The tool is decoupled from its **content**: it fetches
a separate _content repo_ (the marketplace of skills, agents, workflows, instructions,
hooks) and submits usage to a separate _analytics repo_. Together these three repos
form **the triad**.

```
┌───────────────────────────┐     fetch registry.json + assets      ┌──────────────────────────┐
│  agent-studio-vscode-plugin│ ────────────────────────────────────▶│  agentic-studio-assets   │
│      (THIS repo — tool)    │      (GitHub Contents API)            │     (content repo)       │
│                            │                                       └──────────────────────────┘
│  • Marketplace webview     │
│  • Inspector sidebar       │     submit usage PR (numbers only)    ┌──────────────────────────┐
│  • Chat participant        │ ────────────────────────────────────▶│  …-analytics (datastore) │
│  • Self-update             │                                       └──────────────────────────┘
└───────────────────────────┘
```

## Quick start (users)

1. Install the `.vsix` (Extensions panel → `…` → _Install from VSIX_, or
   `code --install-extension dist/agent-studio-0.1.0.vsix`).
2. Sign in with GitHub when prompted (the **Agent Studio** sidebar appears).
3. Open the **Marketplace** (`Agent Studio: Open Marketplace`) and install assets.
4. Chat with `@agent-studio` in Copilot Chat.

## Quick start (maintainers)

```bash
npm install
npm run typecheck      # tsc (extension) + tsc (webview)
npm run build          # esbuild → dist/extension.js + dist/marketplace-webview.js
npm run package:vsix   # → dist/agent-studio-<version>.vsix
# Press F5 in VS Code to launch an Extension Development Host.
```

## Documentation

The full maintainer documentation lives in [`docs/`](./docs/README.md):

| Doc | What it covers |
|-----|----------------|
| [Getting Started](./docs/getting-started.md) | Install, run from source, first change |
| [Architecture Overview](./docs/architecture.md) | The big picture, layers, lifecycle |
| [Software Design Document (SDD)](./docs/SDD.md) | Authoritative design: components, contracts, decisions |
| [The Triad](./docs/the-triad.md) | How tool ↔ content ↔ analytics connect end-to-end |
| [Development Guide](./docs/development.md) | Build, run, debug, test, package |
| [Subsystems Deep-Dive](./docs/subsystems.md) | Every subsystem, file-by-file |
| [Configuration & `.env`](./docs/configuration.md) | Every setting + env var + resolution order |
| [Webview ⇄ Host Protocol](./docs/message-protocol.md) | The typed message contract |
| [Extending the Extension](./docs/extending.md) | Add an asset type, marketplace, command, tab |
| [Release & Self-Update](./docs/release-and-self-update.md) | Packaging, releasing, the auto-update flow |
| [Glossary](./docs/glossary.md) | Every term in one place |

**New here?** Read [Getting Started](./docs/getting-started.md) →
[Architecture Overview](./docs/architecture.md) → [The Triad](./docs/the-triad.md),
then dip into the [SDD](./docs/SDD.md) and [Subsystems](./docs/subsystems.md) as needed.

## Status

- Zero runtime dependencies beyond React (bundled). No `gh` CLI, no Octokit — raw
  `fetch` against the GitHub REST API.
- Org-gating is a **feature flag, OFF by default** (single private-repo mode).
- All repo/org routes are **`.env`-driven** (see [Configuration](./docs/configuration.md)).

## License

Internal / proprietary. See repository settings.
