// @ts-check
// Agent Studio Marketplace — webview-side JS
/// <reference lib="dom" />

const vscode = acquireVsCodeApi();

/** @type {Map<string, {installed:boolean}>} */
const assetStates = new Map();
/** @type {Map<string, boolean>} */
const mcpStates = new Map();
/** @type {Map<string, boolean>} */
const pluginStates = new Map();
/** @type {Array<Object>} */
let allAssets = [];

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  vscode.postMessage({ type: 'marketplace:ready' });
  initTabs();
  initSearch();
  initPluginToolbar();
});

function initTabs() {
  document.querySelectorAll('.mp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mp-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.mp-panel').forEach(p => p.classList.remove('visible'));
      tab.classList.add('active');
      const target = /** @type {HTMLElement} */ (tab).dataset.tab;
      document.getElementById(target)?.classList.add('visible');
      // Search bar only for AI Assets
      const searchRow = document.getElementById('searchRow');
      if (searchRow) searchRow.style.display = target === 'panelAssets' ? 'flex' : 'none';
    });
  });
}

function initSearch() {
  let timer;
  const search = /** @type {HTMLInputElement} */ (document.getElementById('searchInput'));
  const filter = /** @type {HTMLSelectElement} */ (document.getElementById('typeFilter'));
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      vscode.postMessage({ type: 'marketplace:filterChange', query: search.value, assetType: filter.value });
    }, 250);
  };
  search?.addEventListener('input', onChange);
  filter?.addEventListener('change', onChange);
}

/**
 * Switch to a tab and optionally pre-select the AI Assets type filter.
 * @param {'assets'|'plugins'|'mcp'|'extensions'|undefined} tab
 * @param {string|undefined} assetType
 */
function applyFilter(tab, assetType) {
  const TAB_IDS = {
    assets: 'panelAssets',
    plugins: 'panelPlugins',
    mcp: 'panelMcp',
    extensions: 'panelExtensions',
  };
  const targetPanelId = tab ? TAB_IDS[tab] : null;
  if (targetPanelId) {
    const btn = document.querySelector(`.mp-tab[data-tab="${targetPanelId}"]`);
    if (btn) /** @type {HTMLElement} */ (btn).click();
  }
  if (assetType) {
    const filter = /** @type {HTMLSelectElement} */ (document.getElementById('typeFilter'));
    if (filter) filter.value = assetType;
    // Host has already re-sent the catalog filtered to this type.
  }
}

function initPluginToolbar() {
  document.getElementById('btnAddMarketplace')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'marketplace:addMarketplace' });
  });
  document.getElementById('btnRefreshPlugins')?.addEventListener('click', () => {
    document.getElementById('pluginsContainer').innerHTML = '<div class="mp-loading">Fetching marketplaces…</div>';
    vscode.postMessage({ type: 'marketplace:refreshPlugins' });
  });
}

// ── Messages ───────────────────────────────────────────────────────────────
window.addEventListener('message', event => {
  const msg = event.data;
  switch (msg.type) {
    // AI Assets
    case 'marketplace:loadCatalog':
      allAssets = msg.assets;
      renderAssets(msg.assets);
      break;
    case 'marketplace:assetState':
      assetStates.set(msg.assetId, { installed: !!msg.installed });
      updateAssetCard(msg.assetId);
      break;
    case 'marketplace:installResult':
      handleInstallResult(msg);
      break;

    // MCP
    case 'marketplace:mcpState':
      mcpStates.set(msg.serverId, msg.installed);
      updateMcpCard(msg.serverId, msg.installed);
      break;
    case 'marketplace:loadMcp':
      renderMcpCatalog(msg.servers);
      break;

    // Copilot Extensions
    case 'marketplace:loadExtensions':
      renderExtensions(msg.extensions);
      break;

    // Initial / external filter (invoked when Library tree asks to browse a type)
    case 'marketplace:applyFilter':
      applyFilter(msg.tab, msg.assetType);
      break;

    // Plugins
    case 'marketplace:pluginsLoading':
      document.getElementById('pluginsContainer').innerHTML =
        '<div class="mp-loading">Fetching marketplaces from GitHub…</div>';
      break;
    case 'marketplace:loadPlugins':
      renderPluginCatalog(msg.groups);
      break;
    case 'marketplace:pluginState':
      pluginStates.set(msg.pluginName, msg.installed);
      updatePluginCard(msg.pluginName, msg.installed);
      break;
  }
});

// ── AI Assets tab ──────────────────────────────────────────────────────────
function renderAssets(assets) {
  const grid = document.getElementById('assetsGrid');
  grid.innerHTML = '';
  if (!assets?.length) {
    grid.innerHTML = '<div class="mp-empty">No assets match your search.</div>';
    return;
  }
  assets.forEach(asset => grid.appendChild(buildAssetCard(asset)));
}

function buildAssetCard(asset) {
  const state = assetStates.get(asset.id) ?? { installed: false };
  const card = document.createElement('div');
  card.className = 'asset-card';
  card.dataset.id = asset.id;

  const tags = (asset.tags ?? []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('');

  card.innerHTML = `
    <div class="asset-card__header">
      <span class="asset-type-badge asset-type-badge--${asset.type}">${asset.type}</span>
      <span class="asset-card__name">${esc(asset.name)}</span>
    </div>
    <p class="asset-card__description">${esc(asset.description)}</p>
    <div class="asset-card__tags">${tags}</div>
    <div class="asset-card__meta">
      <span>v${esc(asset.version)}</span>
      <span>${esc(asset.source)}</span>
    </div>
    <div class="asset-card__actions">
      <button class="btn ${state.installed ? 'btn-success' : 'btn-primary'}" data-action="install-toggle"
        title="${state.installed ? 'Uninstall from .github/' : 'Install to .github/'}">
        ${state.installed ? '✓ Installed' : '↓ Install'}
      </button>
      <button class="btn btn-secondary" data-action="preview">Preview</button>
    </div>`;

  card.querySelector('[data-action="install-toggle"]').addEventListener('click', () => {
    const currentlyInstalled = assetStates.get(asset.id)?.installed ?? false;
    vscode.postMessage({
      type: currentlyInstalled ? 'marketplace:uninstall' : 'marketplace:install',
      assetId: asset.id,
    });
  });

  card.querySelector('[data-action="preview"]').addEventListener('click', () => {
    vscode.postMessage({ type: 'marketplace:preview', assetId: asset.id });
  });

  return card;
}

function updateAssetCard(assetId) {
  const card = document.querySelector(`[data-id="${assetId}"]`);
  if (!card) return;
  const installed = assetStates.get(assetId)?.installed ?? false;
  const btn = /** @type {HTMLButtonElement} */ (card.querySelector('[data-action="install-toggle"]'));
  if (!btn) return;
  btn.className = `btn ${installed ? 'btn-success' : 'btn-primary'}`;
  btn.textContent = installed ? '✓ Installed' : '↓ Install';
  btn.title = installed ? 'Uninstall from .github/' : 'Install to .github/';
}

function handleInstallResult({ assetId, success, error }) {
  if (!success) console.error('[Agent Studio] Install failed:', error);
}

// ── Plugins tab ────────────────────────────────────────────────────────────

/**
 * @param {Array<{marketplace: {id:string,label:string,owner:string,repo:string}, plugins: Array}>} groups
 */
function renderPluginCatalog(groups) {
  const container = document.getElementById('pluginsContainer');
  container.innerHTML = '';

  if (!groups || groups.length === 0) {
    container.innerHTML = '<div class="mp-empty">No marketplaces available. Add one with "+ Add Marketplace".</div>';
    return;
  }

  for (const group of groups) {
    const { marketplace, plugins } = group;

    // Marketplace header
    const header = document.createElement('div');
    header.className = 'marketplace-header';
    header.innerHTML = `
      <div class="marketplace-header__info">
        <span class="marketplace-header__label">${esc(marketplace.label)}</span>
        <span class="marketplace-header__repo">${esc(marketplace.owner)}/${esc(marketplace.repo)}</span>
      </div>
      <span class="marketplace-header__count">${plugins.length} plugin${plugins.length !== 1 ? 's' : ''}</span>`;
    container.appendChild(header);

    if (plugins.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mp-empty mp-empty--inline';
      empty.textContent = 'No plugins found in this marketplace (network error or empty).';
      container.appendChild(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'mp-grid';
      grid.style.marginBottom = '20px';
      plugins.forEach(plugin => grid.appendChild(buildPluginCard(plugin, marketplace)));
      container.appendChild(grid);
    }
  }
}

const PLUGIN_TYPE_LABELS = {
  framework:    'Framework',
  'agent-pack': 'Agent Pack',
  'skill-pack': 'Skill Pack',
  toolkit:      'Toolkit',
  plugin:       'Plugin',
};

const COMP_ICONS = {
  agents: '🤖', skills: '🔧', hooks: '⚡', mcp: '🔌', lsp: '📡',
  instructions: '📖', workflows: '🌿',
};

const DOC_LABELS = {
  sdd: 'SDD', tdd: 'TDD', adr: 'ADR', 'api-docs': 'API Docs',
  changelog: 'Changelog', 'test-plan': 'Test Plan', runbook: 'Runbook',
  readme: 'README', 'user-story': 'User Story',
};

function buildPluginCard(plugin, marketplace) {
  const installed = pluginStates.get(plugin.name) ?? plugin.installed ?? false;
  const isFramework = plugin.type === 'framework';
  const typeLabel = PLUGIN_TYPE_LABELS[plugin.type] ?? 'Plugin';
  const typeClass = plugin.type ?? 'plugin';

  const card = document.createElement('div');
  card.className = `plugin-card${isFramework ? ' plugin-card--framework' : ''}`;
  card.dataset.pluginName = plugin.name;

  // Header
  const author = plugin.author ? `<span class="plugin-card__author">by ${esc(plugin.author)}</span>` : '';

  // Components
  const comps = (plugin.components ?? []);
  const compBadges = comps.map(c =>
    `<span class="comp-badge comp-badge--${c}" title="${c}">${COMP_ICONS[c] ?? ''} ${c}</span>`
  ).join('');

  // Phases (frameworks only)
  const phasesHtml = isFramework && plugin.phases?.length
    ? `<div class="plugin-phases">
        ${plugin.phases.map((p, i) => `
          <span class="phase-step">${esc(p)}</span>
          ${i < plugin.phases.length - 1 ? '<span class="phase-arrow">→</span>' : ''}
        `).join('')}
       </div>`
    : '';

  // Agent hierarchy
  const agentHtml = plugin.agentCount
    ? `<div class="agent-hierarchy">
        <span class="agent-badge agent-badge--orchestrator">
          🎯 ${plugin.agentCount.orchestrators} orchestrator${plugin.agentCount.orchestrators !== 1 ? 's' : ''}
        </span>
        <span class="agent-badge agent-badge--specialist">
          🔬 ${plugin.agentCount.specialists} specialist${plugin.agentCount.specialists !== 1 ? 's' : ''}
        </span>
       </div>`
    : '';

  // Documents generated
  const docsHtml = plugin.generates?.length
    ? `<div class="generates-row">
        <span class="generates-label">Generates:</span>
        ${plugin.generates.map(d =>
          `<span class="doc-badge">${DOC_LABELS[d] ?? d}</span>`
        ).join('')}
       </div>`
    : '';

  // Way of working
  const wowHtml = plugin.wayOfWorking
    ? `<p class="plugin-wow">"${esc(plugin.wayOfWorking)}"</p>`
    : '';

  // Domains / keywords
  const tags = [...(plugin.domains ?? []), ...(plugin.keywords ?? [])]
    .slice(0, 5)
    .map(t => `<span class="tag">${esc(t)}</span>`).join('');

  const homepage = plugin.homepage
    ? `<a href="${esc(plugin.homepage)}" class="btn btn-external" style="flex:0" target="_blank">Docs ↗</a>`
    : '';

  card.innerHTML = `
    <div class="plugin-card__header">
      <span class="asset-type-badge asset-type-badge--${typeClass}">${typeLabel}</span>
      <div style="flex:1;min-width:0">
        <div class="plugin-card__name">${esc(plugin.name)}</div>
        ${author}
      </div>
      <span class="plugin-card__version">v${esc(plugin.version)}</span>
    </div>

    <p class="asset-card__description">${esc(plugin.description)}</p>

    ${wowHtml}
    ${phasesHtml}
    ${agentHtml}
    ${docsHtml}
    ${compBadges ? `<div class="comp-badges">${compBadges}</div>` : ''}
    ${tags ? `<div class="asset-card__tags">${tags}</div>` : ''}

    <div class="asset-card__actions">
      <button class="btn ${installed ? 'btn-success' : 'btn-primary'}" data-action="plugin-install"
        ${installed ? 'disabled' : ''}>
        ${installed ? '✓ Installed' : '↓ Install'}
      </button>
      ${installed ? `<button class="btn btn-danger" data-action="plugin-uninstall" style="flex:0;padding:4px 8px" title="Uninstall">✕</button>` : ''}
      ${homepage}
    </div>`;

  card.querySelector('[data-action="plugin-install"]')?.addEventListener('click', () => {
    const btn = /** @type {HTMLButtonElement} */ (card.querySelector('[data-action="plugin-install"]'));
    btn.textContent = 'Installing…';
    btn.disabled = true;
    vscode.postMessage({ type: 'marketplace:installPlugin', pluginName: plugin.name, marketplaceId: marketplace.id });
  });

  card.querySelector('[data-action="plugin-uninstall"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'marketplace:uninstallPlugin', pluginName: plugin.name });
  });

  return card;
}

function updatePluginCard(pluginName, installed) {
  const card = document.querySelector(`[data-plugin-name="${pluginName}"]`);
  if (!card) return;
  const btn = /** @type {HTMLButtonElement} */ (card.querySelector('[data-action="plugin-install"]'));
  if (btn) {
    btn.textContent = installed ? '✓ Installed' : '↓ Install';
    btn.className = installed ? 'btn btn-success' : 'btn btn-primary';
    btn.disabled = installed;
  }
}

// ── MCP tab ────────────────────────────────────────────────────────────────
function renderMcpCatalog(servers) {
  const grid = document.getElementById('mcpGrid');
  grid.innerHTML = '';
  servers.forEach(server => grid.appendChild(buildMcpCard(server)));
}

function buildMcpCard(server) {
  const installed = mcpStates.get(server.id) ?? false;
  const card = document.createElement('div');
  card.className = 'mcp-card';
  card.dataset.mcpId = server.id;

  const tags = (server.tags ?? []).slice(0, 3).map(t =>
    `<span class="tag ${t==='official'?'tag--official':''}">${esc(t)}</span>`
  ).join('');

  const needsEnv = server.env && Object.keys(server.env).length > 0;
  const envWarning = needsEnv
    ? `<div class="env-warning">⚠ Requires env vars: ${Object.keys(server.env).join(', ')}</div>`
    : '';

  const runner = server.requiresNpx ? 'npx' : server.requiresUvx ? 'uvx' : '';
  const runnerBadge = runner ? `<span class="tag">${runner}</span>` : '';

  card.innerHTML = `
    <div class="mcp-card__header">
      <span class="asset-type-badge asset-type-badge--mcp">MCP</span>
      <span class="mcp-card__name">${esc(server.name)}</span>
      ${runnerBadge}
    </div>
    <p class="asset-card__description">${esc(server.description)}</p>
    <div class="asset-card__tags">${tags}</div>
    ${envWarning}
    <div class="asset-card__actions">
      <button class="btn ${installed ? 'btn-success' : 'btn-primary'}" data-action="mcp-install" ${installed?'disabled':''}>
        ${installed ? '✓ Installed' : 'Install to .vscode/mcp.json'}
      </button>
      ${server.installDocs ? `<a href="${esc(server.installDocs)}" class="btn btn-external" target="_blank">Docs ↗</a>` : ''}
    </div>`;

  card.querySelector('[data-action="mcp-install"]')?.addEventListener('click', () => {
    const btn = /** @type {HTMLButtonElement} */ (card.querySelector('[data-action="mcp-install"]'));
    btn.textContent = 'Installing…';
    btn.disabled = true;
    vscode.postMessage({ type: 'marketplace:installMcp', serverId: server.id });
  });

  return card;
}

function updateMcpCard(serverId, installed) {
  const card = document.querySelector(`[data-mcp-id="${serverId}"]`);
  if (!card) return;
  const btn = /** @type {HTMLButtonElement} */ (card.querySelector('[data-action="mcp-install"]'));
  if (btn) {
    btn.textContent = installed ? '✓ Installed' : 'Install to .vscode/mcp.json';
    btn.className = installed ? 'btn btn-success' : 'btn btn-primary';
    btn.disabled = installed;
  }
}

// ── Copilot Extensions tab ─────────────────────────────────────────────────
function renderExtensions(extensions) {
  const grid = document.getElementById('extensionsGrid');
  grid.innerHTML = '';

  const byCategory = {};
  extensions.forEach(ext => {
    if (!byCategory[ext.category]) byCategory[ext.category] = [];
    byCategory[ext.category].push(ext);
  });

  for (const [category, exts] of Object.entries(byCategory)) {
    const header = document.createElement('div');
    header.className = 'section-header';
    header.textContent = category;
    grid.appendChild(header);

    const row = document.createElement('div');
    row.className = 'mp-grid';
    row.style.marginBottom = '16px';
    exts.forEach(ext => row.appendChild(buildExtCard(ext)));
    grid.appendChild(row);
  }
}

function buildExtCard(ext) {
  const card = document.createElement('div');
  card.className = 'ext-card';

  const tags = (ext.tags ?? [])
    .filter(t => t !== 'official')
    .slice(0, 3)
    .map(t => `<span class="tag">${esc(t)}</span>`).join('');

  const isOfficial = ext.tags?.includes('official');

  card.innerHTML = `
    <div class="ext-card__header">
      <span class="asset-type-badge asset-type-badge--extension">Extension</span>
      <div style="flex:1">
        <div class="ext-card__name">${esc(ext.name)} ${isOfficial ? '<span class="tag tag--official">official</span>' : ''}</div>
        <div class="ext-card__publisher">${esc(ext.publisher)}</div>
      </div>
    </div>
    <p class="asset-card__description">${esc(ext.description)}</p>
    <div class="asset-card__tags">${tags}</div>
    <div class="asset-card__actions">
      <button class="btn btn-external" onclick="window.open('${esc(ext.marketplaceUrl)}')">
        Install on GitHub ↗
      </button>
    </div>
    <p style="font-size:10px;color:var(--muted);margin-top:2px">
      After installing on GitHub, use <code>@${esc(ext.name.toLowerCase())}</code> in Copilot Chat
    </p>`;

  return card;
}

// ── Utils ──────────────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
