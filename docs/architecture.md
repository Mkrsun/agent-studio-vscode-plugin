# Architecture Overview

This is the mental model. It's the map you keep in your head; the [SDD](./SDD.md) is the
detailed reference, and [Subsystems](./subsystems.md) is the file-by-file tour.

## 1. What Agent Studio _is_

A VS Code extension that distributes Copilot **assets** from a central repo, exports them
into **native Copilot files**, runs a **chat participant** with multi-phase workflows, and
**measures usage** — all configurable through `.env`.

The single most important idea: **Agent Studio feeds Copilot, it does not intercept it.**
"Installing" an asset writes a file under `.github/` that Copilot reads natively.

## 2. The three runtime worlds

```
   ┌────────────────────┐   postMessage (typed by protocol.ts)   ┌────────────────────┐
   │  EXTENSION HOST     │ ◀──────────────────────────────────▶ │   WEBVIEW (React)   │
   │  Node · src/        │                                       │  browser · webview-ui/
   │  vscode.* · fs · env│                                       │  no Node, no vscode │
   └─────────┬──────────┘                                       └────────────────────┘
             │ fetch (+ GitHub session token)
             ▼
   ┌────────────────────────────────────────────┐
   │  GitHub REST API + VS Code LM API (Copilot) │
   └────────────────────────────────────────────┘
```

1. **Extension host** — the Node process. All business logic. Has the file system,
   `process.env`, and the `vscode.*` APIs.
2. **Webview** — the marketplace UI, a sandboxed React app. It has _no_ direct access to
   anything; it communicates only via `postMessage`, and every message is typed by
   `src/shared/protocol.ts`.
3. **External services** — GitHub (content, releases, identity) over raw `fetch`, and the
   Copilot Language Model via `vscode.lm`.

Keeping these three straight explains most of the codebase: anything touching files,
network, or `vscode.*` lives in `src/`; anything visual in the marketplace lives in
`webview-ui/`; the bridge between them is `protocol.ts`.

## 3. The triad (system context)

Agent Studio (the tool) is decoupled from its content and its analytics:

```
 agent-studio-vscode-plugin  ──fetch registry.json + assets──▶  agentic-studio-assets
        (tool)               ──submit usage PR (numbers only)─▶  …-analytics
```

The tool never hardcodes the others — each is resolved `env → setting → default`. See
[The Triad](./the-triad.md) for the exact flows and contracts.

## 4. Layers (top to bottom)

| Layer | Examples | Responsibility |
|-------|----------|----------------|
| **Presentation** | Inspector tree, Marketplace webview, chat participant | What the user sees/touches |
| **Application** | inspector commands, panel handlers, phase/skill runners, usageSubmitter | Orchestrate a user action |
| **Domain services** | AssetLoader, ScopeService, CopilotExporter, MarketplaceService | The core nouns & verbs |
| **Platform** | AuthService, MarketplaceClient, ConfigService, dotenv | Talk to GitHub, settings, env |
| **Cross-cutting** | constants, models/types, shared/protocol, utils | Shared contracts & helpers |

A user action flows **down** the layers and the result flows **back up**: e.g. _click
Install_ (presentation) → _panel handler_ (application) → _ScopeService + CopilotExporter_
(domain) → _file write_ (platform) → _assetState message_ back to the webview.

## 5. The lifecycle (boot sequence)

```
activate()                   # a flat sequence of named steps (no nested closures)
  1. initLogger()            # "Agent Studio" output channel up first
  2. loadDotEnv()            # .env → process.env (before anything reads overrides)
  3. isDevAuthBypass?        # only in Extension Dev Host + flag → activateWithoutAuth()
  4. AuthService + auth cmds # signIn / signOut / showAuthStatus / showLogs
  5. AuthSurfaceManager.start()   # owns sign-in ↔ authenticated surface swap
       on authenticated → AuthenticatedSurface.build()
         selfUpdate()             # newer VSIX (≤1/day)
         MarketplaceService.init()# parallel registry fetches
         loadAndAutoUpdate()      # load assets; auto-update opted-in ones
         InspectorProvider        # sidebar tree (hierarchy-aware)
         registerParticipant()    # @agent-studio
         register all commands    # each a named method
```

**Why lazy?** The authenticated surface is built only after a GitHub session exists, so an
unauthenticated user sees just the sign-in affordance and no service touches the network
without a token. See [SDD §4.1](./SDD.md#41-activation--lifecycle-extensionts-authauthgatets).

## 6. The asset pipeline (the core flow)

This is the spine of the extension — worth memorizing:

```
content repo (registry.json + YAML)
   │  MarketplaceClient (GitHub Contents API)
   ▼
MarketplaceService  ──refs──▶  AssetLoader  ──parsed assets──▶  in-memory catalog
                                   │
                ScopeService (session | repo | disabled) + installed version
                                   │  repo-scoped only
                                   ▼
                         CopilotExporter ──writes──▶ .github/{prompts,chatmodes,instructions}/<id>.*
                                   │  (one flat file per asset, consolidated by id)
                                   ▼
                          GitHub Copilot reads them natively
```

Two-level scoping is key:
- **session** — try it in chat, no files written.
- **repo** — commit it for the team, exported to `.github/`.
- **disabled** — off.

## 7. Configuration model

Everything routable resolves in the same order:

```
process.env (incl. .env)   →   VS Code setting   →   built-in default
```

So ops can repoint the content repo, analytics repo, update repo, or org list entirely
through `.env`, with no settings edits and no rebuild. See
[Configuration](./configuration.md).

## 8. What to read next

- The exact connections and contracts: **[The Triad](./the-triad.md)**
- The authoritative design + decisions: **[SDD](./SDD.md)**
- File-by-file: **[Subsystems](./subsystems.md)**
