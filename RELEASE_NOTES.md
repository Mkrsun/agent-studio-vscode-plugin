# Release Notes

Per-release changelog. Overwrite this file before each tag — it is consumed by
`npm run release` (`gh release create --notes-file RELEASE_NOTES.md`).

## v0.1.0 — Enterprise Auth

- **GitHub SSO hard-block**: extension surfaces (chat participant, tree views, marketplace, inspector, commands) are gated behind GitHub authentication and active membership in a configured MetLife GitHub organization. Fail-closed on network/API failure.
- **Dev bypass**: `agentStudio.auth.bypassForDev` enables full access in Extension Development Host (F5). Ignored in production-installed `.vsix`.
- **In-extension update checker**: once per day, compares `package.json` version against the latest GitHub Release on `MetLife-Global/agent-studio-vscode-plugin` and prompts with a dismissible toast.

## Install

```bash
gh release download --repo MetLife-Global/agent-studio-vscode-plugin -p "*.vsix" --dir /tmp
code --install-extension /tmp/agent-studio-*.vsix
```
