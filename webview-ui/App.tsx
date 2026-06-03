import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from './platform/vscodeApi';
import { useMessages } from './platform/useMessages';
import type { HostMessage, MarketplaceTabId } from './protocol';
import { useAssets } from './features/assets/useAssets';
import { AssetsTab } from './features/assets/AssetsTab';
import { usePlugins } from './features/plugins/usePlugins';
import { PluginsTab } from './features/plugins/PluginsTab';
import { useMcp } from './features/mcp/useMcp';
import { McpTab } from './features/mcp/McpTab';
import { useExtensions } from './features/extensions/useExtensions';
import { ExtensionsTab } from './features/extensions/ExtensionsTab';

const TABS: { id: MarketplaceTabId; label: string }[] = [
  { id: 'assets', label: 'AI Assets' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'extensions', label: 'Copilot Extensions' },
];

const TYPE_OPTIONS = ['all', 'skill', 'agent', 'workflow', 'instruction', 'hook'];

export function App(): JSX.Element {
  const [tab, setTab] = useState<MarketplaceTabId>('assets');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const assets = useAssets();
  const plugins = usePlugins();
  const mcp = useMcp();
  const extensions = useExtensions();

  // Tell the host we're ready (it then streams catalogs + states).
  useEffect(() => { post({ type: 'marketplace:ready' }); }, []);

  // External "browse this type" requests from the sidebar.
  useMessages(useCallback((msg: HostMessage) => {
    if (msg.type === 'marketplace:applyFilter') {
      if (msg.tab) setTab(msg.tab);
      if (msg.assetType) setTypeFilter(msg.assetType);
    }
  }, []));

  // Debounced search → host re-filters the catalog.
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const fire = useCallback((q: string, t: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => assets.filterChange(q, t), 250);
  }, [assets]);

  const onQuery = (q: string): void => { setQuery(q); fire(q, typeFilter); };
  const onType = (t: string): void => { setTypeFilter(t); fire(query, t); };

  return (
    <div id="app">
      <header className="mp-header">
        <div className="mp-header__top">
          <span className="mp-header__icon">◈</span>
          <h1>Agent Studio Marketplace</h1>
        </div>
        {tab === 'assets' && (
          <div className="mp-header__controls">
            <input
              type="text"
              className="mp-search"
              placeholder="Search assets…"
              autoComplete="off"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
            />
            <select className="mp-filter" value={typeFilter} onChange={(e) => onType(e.target.value)}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t === 'all' ? 'All Types' : t[0].toUpperCase() + t.slice(1) + 's'}</option>
              ))}
            </select>
          </div>
        )}
        <div className="mp-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`mp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="mp-panel visible">
        {tab === 'assets' && <AssetsTab api={assets} />}
        {tab === 'plugins' && <PluginsTab api={plugins} />}
        {tab === 'mcp' && <McpTab api={mcp} />}
        {tab === 'extensions' && <ExtensionsTab api={extensions} />}
      </div>
    </div>
  );
}
