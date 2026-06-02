import { Button, Loading, Tag, TypeBadge } from '../../shared/ui';
import type { McpServer } from '../../protocol';
import type { McpApi } from './useMcp';

export function McpTab({ api }: { api: McpApi }): JSX.Element {
  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        MCP (Model Context Protocol) servers extend Copilot with tools — file access, GitHub, databases,
        search, and more. Installed to <code>.vscode/mcp.json</code> in your workspace.
      </p>
      {!api.loaded ? (
        <Loading>Loading MCP catalog…</Loading>
      ) : (
        <div className="mp-grid">
          {api.servers.map((s) => <McpCard key={s.id} server={s} api={api} />)}
        </div>
      )}
    </>
  );
}

function McpCard({ server, api }: { server: McpServer; api: McpApi }): JSX.Element {
  const installed = api.isInstalled(server.id);
  const envKeys = server.env ? Object.keys(server.env) : [];
  const runner = server.requiresNpx ? 'npx' : server.requiresUvx ? 'uvx' : '';
  return (
    <div className="mcp-card">
      <div className="mcp-card__header">
        <TypeBadge type="mcp" label="MCP" />
        <span className="mcp-card__name">{server.name}</span>
        {runner && <Tag>{runner}</Tag>}
      </div>
      <p className="asset-card__description">{server.description}</p>
      <div className="asset-card__tags">
        {(server.tags ?? []).slice(0, 3).map((t) => <Tag key={t} official={t === 'official'}>{t}</Tag>)}
      </div>
      {envKeys.length > 0 && <div className="env-warning">⚠ Requires env vars: {envKeys.join(', ')}</div>}
      <div className="asset-card__actions">
        <Button variant={installed ? 'success' : 'primary'} disabled={installed} onClick={() => api.install(server.id)}>
          {installed ? '✓ Installed' : 'Install to .vscode/mcp.json'}
        </Button>
        {server.installDocs && (
          <a href={server.installDocs} className="btn btn-external" target="_blank" rel="noreferrer">Docs ↗</a>
        )}
      </div>
    </div>
  );
}
