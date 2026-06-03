# Agent Studio — Maintainer Documentation

Welcome. This is the documentation hub for **maintainers** of the Agent Studio VS Code
extension and the surrounding triad. It is written to take you from _getting started_
to _mastering the entire stack_.

## Reading order

We recommend reading in this order the first time:

1. **[Getting Started](./getting-started.md)** — clone, build, run from source, make your
   first change. (~15 min)
2. **[Architecture Overview](./architecture.md)** — the mental model: layers, lifecycle,
   the triad, key design principles. (~20 min)
3. **[The Triad](./the-triad.md)** — how the tool, the content repo, and the analytics
   repo connect, with the exact data flows. (~15 min)
4. **[Development Guide](./development.md)** — the day-to-day loop: build, debug, test,
   package, common tasks. (~15 min)

Then go deep as needed:

5. **[Software Design Document (SDD)](./SDD.md)** — the authoritative design reference.
   Components, responsibilities, contracts, sequence diagrams, design decisions, and the
   things that are deliberately _not_ done.
6. **[Subsystems Deep-Dive](./subsystems.md)** — every subsystem, file-by-file, with the
   key classes, methods, and data flows.
7. **[Configuration & `.env`](./configuration.md)** — every VS Code setting and env var,
   the resolution order, and how `.env` is loaded.
8. **[Webview ⇄ Host Protocol](./message-protocol.md)** — the typed message contract that
   joins the extension and the React webview.
9. **[Extending the Extension](./extending.md)** — recipes: add an asset type, a
   marketplace source, a command, a webview tab.
10. **[Release & Self-Update](./release-and-self-update.md)** — packaging the `.vsix`,
    publishing a release, and how the extension updates itself.
11. **[Glossary](./glossary.md)** — every term, in one place.

## The 60-second mental model

- **Agent Studio is a tool, decoupled from its content.** It fetches a **content repo**
  (the marketplace: skills, agents, workflows, instructions, hooks) over the GitHub
  Contents API, and submits **usage** to an **analytics repo** as PRs.
- **Assets are exported to native Copilot files.** When you "install" an asset, the
  extension writes it into `.github/` (`prompts/`, `chatmodes/`, `instructions/`,
  `copilot-instructions.md`) so **GitHub Copilot picks it up natively** — Agent Studio
  doesn't intercept Copilot, it _feeds_ it.
- **Everything routable is `.env`-driven.** Which content repo, which analytics repo,
  which update repo, which orgs — all resolve `env → setting → default`.
- **Auth gates the surface.** Nothing renders until a GitHub session exists; org-gating
  is an opt-in flag.

## Conventions used in these docs

- `path/like/this.ts:42` — a clickable file:line reference into the source.
- **Bold** for the first mention of a defined term (see the [Glossary](./glossary.md)).
- Code blocks labelled `ts`, `json`, `yaml`, `bash` for copy-paste.
- "Host" = the extension running in the VS Code extension host (Node). "Webview" = the
  React app running in the marketplace panel (browser sandbox).

## Where the code lives (one-screen map)

```
src/
├── extension.ts            # activate(): the entry point
├── constants.ts            # COMMANDS, CONFIG_KEYS, ENV, VIEW_IDS, CONTEXT_KEYS
├── auth/                   # GitHub session, org-gating, self-update
├── participant/            # @agent-studio chat participant + workflow phases
├── inspector/              # the sidebar TreeView (asset navigator)
├── marketplace/            # marketplace data layer + webview host + MCP/plugins
├── services/               # assetLoader, scopeService, copilotExporter, configService, dotenv
├── analytics/              # usageSubmitter (the Submit Usage command)
├── shared/protocol.ts      # the typed Host⇄Webview contract (single source of truth)
├── models/                 # Asset type definitions + YAML validators
└── utils/                  # version compare, webview nonce
webview-ui/                 # the React marketplace app (bundled separately by esbuild)
scripts/                    # gen-registry, release (zero-dep .mjs tooling)
```

See [Subsystems](./subsystems.md) for the full file-by-file breakdown.
