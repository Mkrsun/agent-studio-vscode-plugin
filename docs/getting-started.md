# Getting Started

This page takes you from a fresh clone to running the extension from source and making
your first change. Budget ~15 minutes.

## Prerequisites

- **Node.js 18+** (the extension bundles target Node 18 / ES2020).
- **VS Code 1.90+**.
- A **GitHub account** with access to the content repo you'll point at.
- `gh` CLI is **optional** — only needed for the `release` script, not for development.

## 1. Clone & install

```bash
git clone https://github.com/Mkrsun/agent-studio-vscode-plugin.git
cd agent-studio-vscode-plugin
npm install
```

## 2. Verify the toolchain

```bash
npm run typecheck   # tsc for the extension AND the webview (two tsconfigs)
npm run build       # esbuild → dist/extension.js + dist/marketplace-webview.js
```

Both should finish with no errors. If `typecheck` passes but `build` fails (or vice
versa), see [Development → Troubleshooting](./development.md#troubleshooting).

## 3. Point at a content repo

The extension fetches its assets from a **content repo**. The simplest way to configure it
for development is a `.env` file at the repo root (it is gitignored):

```bash
cp .env.example .env
```

Then edit `.env` so it points at a marketplace you can read, e.g.:

```bash
AGENT_STUDIO_MARKETPLACE_REPO=Mkrsun/agentic-studio-assets
```

`.env` is loaded into `process.env` at activation (real shell env always wins). Full
details in [Configuration](./configuration.md).

> **Tip — local content without GitHub:** a marketplace descriptor can use `localPath`
> instead of `repo` to read a content repo from disk. Useful when iterating on assets and
> the tool together. See [Configuration → Local marketplaces](./configuration.md#local-marketplaces).

## 4. Run it (Extension Development Host)

Press **F5** in VS Code (or Run → Start Debugging). This:

1. Builds the bundles (via the `preLaunchTask`, or run `npm run watch` yourself).
2. Opens a second VS Code window — the **Extension Development Host** — with Agent Studio
   loaded.

In that window:

1. Sign in with GitHub when prompted → the **Agent Studio** sidebar appears.
2. Run **`Agent Studio: Open Marketplace`** from the Command Palette.
3. You should see the assets from your configured content repo. Install one; check that a
   file appears under `.github/` in the dev window's workspace.
4. Open Copilot Chat and type `@agent-studio /discover` to exercise the chat participant.

> **Dev auth shortcut:** set `agentStudio.auth.bypassForDev: true` in the dev window's
> settings to skip the GitHub sign-in **while developing**. It has no effect in a packaged
> `.vsix`.

## 5. The watch loop

For fast iteration, run the bundler in watch mode in a terminal:

```bash
npm run watch
```

Then use **Developer: Reload Window** in the Extension Development Host after changes to
the **extension** (`src/`). Changes to the **webview** (`webview-ui/`) require closing and
reopening the marketplace panel (or reloading the window).

## 6. Make your first change

A good first change: add a log line and a new field to a host→webview message.

1. Open `src/marketplace/marketplacePanel.ts`, find `_handle`, and add a
   `console.log('handling', msg.type)` at the top.
2. Reload the dev window, open the marketplace, and watch the **Debug Console** in the
   primary window — you'll see the message types stream by.

When you're comfortable, read [Extending](./extending.md) for real recipes (new asset
type, new command, new tab).

## 7. Package a `.vsix` (optional)

```bash
npm run package:vsix      # → dist/agent-studio-<version>.vsix
code --install-extension dist/agent-studio-<version>.vsix
```

This installs the **packaged** extension into your normal VS Code (not the dev host) so you
can dogfood it. See [Release & Self-Update](./release-and-self-update.md) for the full
packaging/release story.

## Where to go next

- **Understand the shape:** [Architecture Overview](./architecture.md)
- **Understand the connections:** [The Triad](./the-triad.md)
- **Daily workflow:** [Development Guide](./development.md)
