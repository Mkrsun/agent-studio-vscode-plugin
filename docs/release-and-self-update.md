# Release & Self-Update

How the `.vsix` is packaged, how a release is published, and how installed extensions
update themselves.

## Packaging the `.vsix`

```bash
npm run package:vsix     # → dist/agent-studio-<version>.vsix
```

This runs `vscode:prepublish` (= `build:prod`) first, then `vsce package`.

### Requirements `vsce` enforces (already satisfied)

- **A PNG icon.** `package.json` → `icon` points at `media/icons/agent-studio.png`
  (128×128). `vsce` rejects SVG icons. If you change the logo, regenerate the PNG.
- **A `repository` field** in `package.json` (present:
  `https://github.com/Mkrsun/agent-studio-vscode-plugin.git`). Without it `vsce` warns.

### `.vscodeignore` — ship only the bundle

The package must contain **only** the bundled output + runtime media — never source or
maps. `.vscodeignore` excludes `src/`, `webview-ui/`, `scripts/`, `**/*.ts`, `**/*.tsx`,
`**/*.map`, `.github/`, build config, and `.env*`. A correct package is ~**9 files,
~105 KB**. If you see source files or maps in the package, the ignore file regressed:

```bash
unzip -l dist/agent-studio-<version>.vsix    # inspect contents
```

Expected payload: `package.json`, `dist/extension.js`, `dist/marketplace-webview.js`,
`media/marketplace/marketplace.css`, `media/icons/agent-studio.{png,svg}`,
`RELEASE_NOTES.md`.

## Publishing a release

```bash
npm run release          # = node scripts/release.mjs
```

`scripts/release.mjs` is zero-dependency and **`.env`-aware**. It resolves the target repo:

```
--repo <owner/repo>   →   AGENT_STUDIO_UPDATE_REPO (incl. .env)   →   Mkrsun/agent-studio-vscode-plugin
```

then runs `gh release create v<version> dist/agent-studio-<version>.vsix --repo <repo>`
(with `--notes-file RELEASE_NOTES.md`, or `--generate-notes` if it's absent). It refuses
to run if the `.vsix` is missing.

```bash
# dry run (prints the gh command, does nothing)
node scripts/release.mjs --dry-run
# explicit target overrides everything
node scripts/release.mjs --repo Acme/agent-studio-vscode-plugin
```

The release **target** is the same repo the self-update **reads**, so publish target and
update source always match by construction (both use `AGENT_STUDIO_UPDATE_REPO`).

### Release checklist

- [ ] Bump `version` in `package.json`.
- [ ] Update `RELEASE_NOTES.md`.
- [ ] `npm run package:vsix` → confirm slim payload.
- [ ] `node scripts/release.mjs --dry-run` → confirm the target repo.
- [ ] `npm run release` (needs `gh` authenticated).

## Self-update (how clients pick it up)

On the first authenticated activation each day, `enforceLatestVersion()`
(`src/auth/updateChecker.ts`) runs:

```
GET /repos/<updateRepo>/releases/latest        (token-authenticated → private repos OK)
[optional] GET <extensionUpdateManifestPath>   (latest.json: minimumVersion / forceUpdate)
  compare via utils/version.isNewer
    if newer (or below minimumVersion, or forceUpdate):
       if autoUpdate enabled → download .vsix (octet-stream, token) →
          workbench.extensions.installExtension → set agentStudio.updating → prompt reload
       else → dismissible toast (once per release tag)
```

Controls (all `env → setting → default`, see [Configuration](./configuration.md)):

| Knob | Setting | Env | Default |
|------|---------|-----|---------|
| Source repo | `agentStudio.extensionUpdateRepo` | `AGENT_STUDIO_UPDATE_REPO` | `Mkrsun/agent-studio-vscode-plugin` |
| Auto-install | `agentStudio.extensionAutoUpdate` | — | `true` |
| Manifest path | `agentStudio.extensionUpdateManifestPath` | — | `''` (Releases only) |

### Optional `latest.json` manifest

Place a JSON file in the update repo at `extensionUpdateManifestPath` to force upgrades:

```json
{ "minimumVersion": "0.2.0", "forceUpdate": false }
```

- `minimumVersion` — clients below this are upgraded even if auto-update is off.
- `forceUpdate` — upgrade regardless of the auto-update setting.

### Throttling & UI lock

- The check runs **at most once per 24h** (per client) unless forced.
- During download/install the `agentStudio.updating` context key is set; `when`-clauses use
  it to disable actions so the user can't act mid-swap.

## Asset auto-update (related but separate)

Distinct from extension self-update: `agentStudio.assetAutoUpdate` (default `true`) causes
repo-scoped **assets** to be re-exported when a newer **registry** version appears (on load
and on catalog refresh), via `marketplace/assetAutoUpdate.ts`. See
[Subsystems §4](./subsystems.md#4-asset-pipeline-srcservices).

Next: [Configuration](./configuration.md) · [SDD §8](./SDD.md#8-build--packaging-design-intent)
