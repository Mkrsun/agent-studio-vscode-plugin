# Development Guide

The day-to-day loop: build, run, debug, test, package — plus common tasks and gotchas.

## Toolchain at a glance

| Tool | Role |
|------|------|
| **TypeScript** (strict) | Type-checking; two configs (extension + webview) |
| **esbuild** | Bundles `dist/extension.js` (CJS) and `dist/marketplace-webview.js` (IIFE) |
| **React** | The marketplace webview UI (bundled, `jsx: automatic`) |
| **@vscode/vsce** | Packages the `.vsix` |
| **eslint** | Lint (`npm run lint`) |
| **gh** (optional) | Only the `release` script needs it |

## npm scripts

```jsonc
"build"          // esbuild → dist/ (dev: sourcemaps on, no minify)
"build:prod"     // esbuild --production (minified, no sourcemaps)
"watch"          // esbuild --watch (both bundles)
"typecheck"      // tsc --noEmit  &&  tsc -p webview-ui/tsconfig.json --noEmit
"lint"           // eslint src --ext ts
"test"           // vscode-test (harness present, not yet configured — see below)
"package:vsix"   // vsce package --no-dependencies -o dist/agent-studio-<version>.vsix
"release"        // node scripts/release.mjs (.env-aware; see Release doc)
"vscode:prepublish" // build:prod (runs automatically before packaging)
```

## The two builds (why there are two of everything)

The extension and the webview are **different runtimes**, so each has its own bundle and
its own `tsconfig`:

| | Extension | Webview |
|-|-----------|---------|
| Entry | `src/extension.ts` | `webview-ui/index.tsx` |
| Output | `dist/extension.js` | `dist/marketplace-webview.js` |
| Format | CJS (Node) | IIFE (browser) |
| `vscode` import | external | **forbidden** |
| tsconfig | `tsconfig.json` | `webview-ui/tsconfig.json` |

`esbuild.mjs` builds both. `npm run typecheck` checks both. If you add a file to the
webview that imports `vscode`, the webview build/typecheck will (correctly) fail.

## Run / debug

1. **F5** (Run → Start Debugging) opens an **Extension Development Host** with the
   extension loaded. Breakpoints in `src/` work in the primary window's debugger.
2. For fast iteration, run `npm run watch` and use **Developer: Reload Window** in the dev
   host after editing `src/`.
3. **Webview changes** (`webview-ui/`): close & reopen the marketplace panel, or reload the
   window. Use the webview's own devtools via **Developer: Open Webview Developer Tools**.

### Dev auth bypass

Set in the dev host's settings to skip GitHub sign-in **while developing**:

```jsonc
"agentStudio.auth.bypassForDev": true
```

It only works in an Extension Development Host (`extensionMode === Development`) and is
ignored in a packaged `.vsix`.

## Configuring content for dev

The fastest path is `.env` at the repo root (gitignored, loaded at activation):

```bash
cp .env.example .env
# then set e.g. AGENT_STUDIO_MARKETPLACE_REPO=Mkrsun/agentic-studio-assets
```

Or use a **local content repo** with a `localPath` marketplace descriptor — see
[Configuration → Local marketplaces](./configuration.md#local-marketplaces).

## Common tasks

| I want to… | Go to |
|------------|-------|
| Add a new asset type | [Extending → New asset type](./extending.md#add-an-asset-type) |
| Add a marketplace source | [Extending → New marketplace](./extending.md#add-a-marketplace-source) |
| Add a command | [Extending → New command](./extending.md#add-a-command) |
| Add a webview tab | [Extending → New webview tab](./extending.md#add-a-webview-tab) |
| Add a host⇄webview message | [Message Protocol](./message-protocol.md#adding-a-message) |
| Change which repo is fetched | [Configuration](./configuration.md) |
| Cut a release | [Release & Self-Update](./release-and-self-update.md) |

## Testing (current state)

There is **no configured test suite yet**. `@vscode/test-cli` + `@vscode/test-electron`
are installed and `npm test` runs `vscode-test`, but no tests exist. When adding tests,
the highest-value, lowest-friction targets are the **pure functions** (no `vscode`
dependency):

- `src/utils/version.ts` — `compareVersions`, `isNewer` (semver edge cases).
- `src/services/configService.ts` — `parseMarketplacesEnv` (all input forms).
- `src/services/dotenv.ts` — `parseDotEnv` (quotes, comments, `export`).
- `src/shared/protocol.ts` — DTO assignability (compile-time).
- `src/services/copilotExporter.ts` — file-body rendering per asset type.

These can run as a plain Node test runner without the VS Code harness, which is the
quickest way to get a green suite started.

## Code style & conventions

- **Match the surrounding code.** Comment density, naming, and idiom are already
  established — follow the file you're editing.
- **Doc-comments on exported symbols.** Classes/functions carry `/** … */` explaining the
  _why_, not just the _what_ — keep that up.
- **No new runtime dependencies** without a strong reason. The project's value includes a
  tiny, audit-friendly dependency surface (raw `fetch`, Node stdlib, bundled React).
- **Contracts are sacred.** Changes to `protocol.ts`, `registry.json` shape, or
  `models/types.ts` ripple across the boundary — update both sides and the docs.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Marketplace is empty | No/!readable content repo configured | Set `AGENT_STUDIO_MARKETPLACE_REPO` (or the settings list); check token access |
| "No access to <repo>" node | Token lacks `repo` scope or repo name wrong | Re-sign-in; verify the repo |
| Webview blank | Webview bundle missing/old | `npm run build`; reopen the panel |
| `vsce package` fails on icon | Icon must be PNG | `media/icons/agent-studio.png` must exist (it does) |
| `.vsix` huge / ships source | `.vscodeignore` regression | Ensure source + maps are excluded (see Release doc) |
| `.env` ignored | Real shell env already sets the var | Shell env wins by design; unset it or edit `.env` |
| Self-update never fires | Throttled (≤1/day) or no newer release | Bump version + publish a release; throttle resets daily |

Next: [Configuration](./configuration.md) · [Extending](./extending.md) ·
[Release & Self-Update](./release-and-self-update.md)
