import { Button, EmptyState, Loading, Tag, TypeBadge } from '../../shared/ui';
import type { PluginEntry, PluginGroup, PluginMarketplaceRef } from '../../protocol';
import type { PluginsApi } from './usePlugins';

const TYPE_LABELS: Record<string, string> = {
  framework: 'Framework', 'agent-pack': 'Agent Pack', 'skill-pack': 'Skill Pack', toolkit: 'Toolkit', plugin: 'Plugin',
};
const COMP_ICONS: Record<string, string> = {
  agents: '🤖', skills: '🔧', hooks: '⚡', mcp: '🔌', lsp: '📡', instructions: '📖', workflows: '🌿',
};
const DOC_LABELS: Record<string, string> = {
  sdd: 'SDD', tdd: 'TDD', adr: 'ADR', 'api-docs': 'API Docs', changelog: 'Changelog',
  'test-plan': 'Test Plan', runbook: 'Runbook', readme: 'README', 'user-story': 'User Story',
};

export function PluginsTab({ api }: { api: PluginsApi }): JSX.Element {
  return (
    <>
      <div className="mp-plugin-toolbar">
        <p className="mp-subtitle">
          Installable packages that bundle agents, skills, hooks and MCP configs. Requires <code>copilot</code> CLI.
          Installed via <code>copilot plugin install</code>.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant="secondary" onClick={api.addMarketplace}>+ Add Marketplace</Button>
          <Button variant="secondary" onClick={api.refresh}>↻ Refresh</Button>
        </div>
      </div>
      {api.loading ? (
        <Loading>Fetching marketplaces from GitHub…</Loading>
      ) : api.groups.length === 0 ? (
        <EmptyState>No marketplaces available. Add one with "+ Add Marketplace".</EmptyState>
      ) : (
        api.groups.map((group) => <PluginGroupView key={group.marketplace.id} group={group} api={api} />)
      )}
    </>
  );
}

function PluginGroupView({ group, api }: { group: PluginGroup; api: PluginsApi }): JSX.Element {
  const { marketplace, plugins } = group;
  return (
    <>
      <div className="marketplace-header">
        <div className="marketplace-header__info">
          <span className="marketplace-header__label">{marketplace.label}</span>
          <span className="marketplace-header__repo">{marketplace.owner}/{marketplace.repo}</span>
        </div>
        <span className="marketplace-header__count">{plugins.length} plugin{plugins.length !== 1 ? 's' : ''}</span>
      </div>
      {plugins.length === 0 ? (
        <EmptyState inline>No plugins found in this marketplace (network error or empty).</EmptyState>
      ) : (
        <div className="mp-grid" style={{ marginBottom: 20 }}>
          {plugins.map((p) => <PluginCard key={p.name} plugin={p} marketplace={marketplace} api={api} />)}
        </div>
      )}
    </>
  );
}

function PluginCard({ plugin, marketplace, api }: { plugin: PluginEntry; marketplace: PluginMarketplaceRef; api: PluginsApi }): JSX.Element {
  const installed = api.isInstalled(plugin.name, plugin.installed);
  const isFramework = plugin.type === 'framework';
  const tags = [...(plugin.domains ?? []), ...(plugin.keywords ?? [])].slice(0, 5);
  return (
    <div className={`plugin-card${isFramework ? ' plugin-card--framework' : ''}`}>
      <div className="plugin-card__header">
        <TypeBadge type={plugin.type ?? 'plugin'} label={TYPE_LABELS[plugin.type ?? 'plugin'] ?? 'Plugin'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="plugin-card__name">{plugin.name}</div>
          {plugin.author && <span className="plugin-card__author">by {plugin.author}</span>}
        </div>
        <span className="plugin-card__version">v{plugin.version}</span>
      </div>

      <p className="asset-card__description">{plugin.description}</p>

      {plugin.wayOfWorking && <p className="plugin-wow">"{plugin.wayOfWorking}"</p>}

      {isFramework && plugin.phases?.length ? (
        <div className="plugin-phases">
          {plugin.phases.map((p, i) => (
            <span key={p}>
              <span className="phase-step">{p}</span>
              {i < plugin.phases!.length - 1 && <span className="phase-arrow">→</span>}
            </span>
          ))}
        </div>
      ) : null}

      {plugin.agentCount && (
        <div className="agent-hierarchy">
          <span className="agent-badge agent-badge--orchestrator">🎯 {plugin.agentCount.orchestrators} orchestrator{plugin.agentCount.orchestrators !== 1 ? 's' : ''}</span>
          <span className="agent-badge agent-badge--specialist">🔬 {plugin.agentCount.specialists} specialist{plugin.agentCount.specialists !== 1 ? 's' : ''}</span>
        </div>
      )}

      {plugin.generates?.length ? (
        <div className="generates-row">
          <span className="generates-label">Generates:</span>
          {plugin.generates.map((d) => <span key={d} className="doc-badge">{DOC_LABELS[d] ?? d}</span>)}
        </div>
      ) : null}

      {plugin.components?.length ? (
        <div className="comp-badges">
          {plugin.components.map((c) => (
            <span key={c} className={`comp-badge comp-badge--${c}`} title={c}>{COMP_ICONS[c] ?? ''} {c}</span>
          ))}
        </div>
      ) : null}

      {tags.length > 0 && <div className="asset-card__tags">{tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>}

      <div className="asset-card__actions">
        <Button variant={installed ? 'success' : 'primary'} disabled={installed} onClick={() => api.install(plugin.name, marketplace.id)}>
          {installed ? '✓ Installed' : '↓ Install'}
        </Button>
        {installed && (
          <Button variant="danger" title="Uninstall" style={{ flex: 0, padding: '4px 8px' }} onClick={() => api.uninstall(plugin.name)}>✕</Button>
        )}
        {plugin.homepage && (
          <a href={plugin.homepage} className="btn btn-external" style={{ flex: 0 }} target="_blank" rel="noreferrer">Docs ↗</a>
        )}
      </div>
    </div>
  );
}
