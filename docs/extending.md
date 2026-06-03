# Extending the Extension

Practical recipes. Each lists the files you touch, in order. Always finish with
`npm run typecheck && npm run build`.

## Add an asset type

Say you want a new type `prompt-pack`.

1. **`src/models/types.ts`** — add the interface (extend `AssetBase`, set `type:
   'prompt-pack'`) and add it to the `Asset` union.
2. **`src/constants.ts`** — add `'prompt-pack'` to `ASSET_TYPES`, and entries in
   `ASSET_TYPE_LABELS` and `ASSET_TYPE_ICONS`.
3. **`src/models/validators.ts`** — parse the type-specific fields from YAML.
4. **`src/services/copilotExporter.ts`** — decide how it exports to `.github/` (which file,
   what frontmatter/body). If it shouldn't export, skip it explicitly.
5. **`src/marketplace/marketplaceTypes.ts`** — `AssetType` already drives the registry ref;
   confirm the new type is allowed.
6. **Webview** — if it should appear in the Assets tab type filter, add it to
   `TYPE_OPTIONS` in `webview-ui/App.tsx`.
7. **Content repo** — author assets of the new type and regenerate `registry.json`.

## Add a marketplace source

Marketplaces are configuration, not code — usually you just set
`AGENT_STUDIO_MARKETPLACES` or `agentStudio.marketplaces` (see
[Configuration](./configuration.md)). You only touch code to change the **default**:

- **`package.json`** → `contributes.configuration` → `agentStudio.marketplaces.default`.
- **`src/marketplace/marketplaceService.ts`** → `_getDescriptors()` if you need new
  resolution logic (e.g. a new env form). Parsing of `AGENT_STUDIO_MARKETPLACES` lives in
  `parseMarketplacesEnv()` in `src/services/configService.ts`.

For Copilot **plugin** marketplaces (not asset marketplaces), edit `DEFAULT_MARKETPLACES`
in `src/marketplace/pluginTypes.ts`.

## Add a command

1. **`src/constants.ts`** — add an ID to `COMMANDS` (e.g.
   `DO_THING: 'agentStudio.doThing'`).
2. **`package.json`** — add to `contributes.commands` (title, optional icon) and, if it
   should appear in the palette only when signed in, to `contributes.menus.commandPalette`
   with `"when": "agentStudio.authenticated"`.
3. **`src/auth/authGate.ts`** — register it inside `registerAuthenticatedSurface` (so it
   exists only when authenticated) with `vscode.commands.registerCommand(COMMANDS.DO_THING,
   handler)`. For always-on commands (rare), register in `extension.ts` instead.
4. If the command needs services, they're already in scope in `authGate` (assetLoader,
   scopeService, configService, marketplaceService, etc.).

> Example to copy: the `agentStudio.submitUsage` command — declared in `constants.ts` +
> `package.json`, registered in `authGate.ts`, implemented in `src/analytics/usageSubmitter.ts`.

## Add a webview tab

1. **Protocol** (`src/shared/protocol.ts`) — add any new `HostMessage`/`WebviewMessage`
   variants the tab needs (and DTOs). See [Message Protocol → Adding a message](./message-protocol.md#adding-a-message).
2. **Feature folder** (`webview-ui/features/<tab>/`):
   - `use<Tab>.ts` — a `useReducer` hook holding the tab's state, exposing actions that
     `post()` messages.
   - `<Tab>Tab.tsx` — the presentation, using `shared/ui.tsx` atoms.
3. **`webview-ui/App.tsx`** — add the tab to the `TABS` array and render
   `{tab === '<id>' && <YourTab api={...} />}`.
4. **Host** (`src/marketplace/marketplacePanel.ts`) — handle the new `WebviewMessage`s in
   `_handle` and post the new `HostMessage`s (e.g. on `marketplace:ready`).

## Add a workflow phase or prompt

- New phase template: add `src/participant/prompts/<phase>.ts` and reference it from
  `contextInjector.ts`.
- New routing: extend `workflowSelector.ts` (commands/trigger phrases) and, if it's a slash
  command, register the command name with the chat participant in `agentParticipant.ts`.

## Add an MCP server to the built-in catalog

Edit the catalog in `src/marketplace/mcpInstaller.ts` (id, name, description, command,
args, env, install docs, tags). It appears in the MCP tab automatically.

## Change what gets exported to `.github/`

All export rendering is in `src/services/copilotExporter.ts`. The per-type file paths and
the `.github/copilot-instructions.md` aggregation live there. Changing this affects how
Copilot consumes assets — update [SDD §4.4](./SDD.md#44-asset-pipeline-servicesassetloaderts-scopeservicets-copilotexporterts)
and [The Triad](./the-triad.md) if the contract changes.

## Checklist for any change

- [ ] `npm run typecheck` (extension **and** webview) is green.
- [ ] `npm run build` succeeds.
- [ ] If you touched a **contract** (`protocol.ts`, `registry.json` shape, `models/types`),
      both sides are updated and the relevant doc is updated.
- [ ] If you added config, it's in `package.json`, `constants.ts`, `configService.ts`, and
      [Configuration](./configuration.md).
- [ ] `npm run package:vsix` still produces a slim `.vsix` (no source/maps — see
      [Release](./release-and-self-update.md)).

Next: [Message Protocol](./message-protocol.md) · [Subsystems](./subsystems.md)
