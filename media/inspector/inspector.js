// @ts-check
/// <reference lib="dom" />
import mermaid from 'mermaid';

const vscode = acquireVsCodeApi();

/** @type {string} */
let currentDsl = '';
let renderCounter = 0;

/** @type {any | null} Last full execution snapshot (for I&O tab). */
let currentExecution = null;

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  darkMode: true,
  fontFamily: 'var(--vscode-font-family, "Segoe UI", system-ui, sans-serif)',
  fontSize: 12,
  flowchart: { curve: 'basis', htmlLabels: true, nodeSpacing: 40, rankSpacing: 50 },
  themeVariables: {
    darkMode: true,
    primaryColor: '#1e3a5f',
    primaryTextColor: '#e8e8e8',
    primaryBorderColor: '#58a6ff',
    lineColor: '#666',
    secondaryColor: '#2d2d2d',
    tertiaryColor: '#1e1e1e',
    background: '#1e1e1e',
    clusterBkg: '#252526',
    clusterBorder: '#444',
    titleColor: '#e8e8e8',
    edgeLabelBackground: '#2d2d2d',
  },
});

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initToolbars();
  initPlayground();
  initFrameworkDropdown();
  vscode.postMessage({ type: 'inspector:ready' });
});

function initToolbars() {
  document.getElementById('insCopyIO')?.addEventListener('click', () => {
    if (!currentExecution?.messages?.length) return;
    const json = JSON.stringify(currentExecution.messages, null, 2);
    navigator.clipboard?.writeText(json).catch(() => {
      // Fallback: ask host (navigator.clipboard not always available in webview)
      vscode.postMessage({ type: 'inspector:copyIoJson' });
    });
  });

  document.getElementById('insClearEvents')?.addEventListener('click', () => {
    const list = document.getElementById('insEventList');
    if (list) list.innerHTML = `<div class="ins-empty"><p>No events yet. Start a workflow.</p></div>`;
  });
}

function initTabs() {
  document.querySelectorAll('.ins-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ins-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.ins-panel').forEach((p) => p.classList.remove('visible'));
      tab.classList.add('active');
      const target = /** @type {HTMLElement} */ (tab).dataset.tab;
      if (target) document.getElementById(target)?.classList.add('visible');
    });
  });
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'inspector:diagramUpdate':
      handleDiagramUpdate(msg);
      break;
    case 'inspector:executionSnapshot':
      currentExecution = msg.execution;
      renderStepList(msg.execution);
      renderIO(msg.execution);
      renderTools(msg.execution);
      break;
    case 'inspector:statusPill':
      renderStatusPill(msg.state, msg.detail);
      break;
    case 'inspector:event':
      appendEvent(msg.event, msg.message, msg.tool);
      break;
    case 'inspector:init':
      updateFrameworkDropdown(msg.installedFrameworks ?? []);
      break;
    case 'inspector:playgroundStream':
      handlePlaygroundChunk(msg.runId, msg.chunk);
      break;
    case 'inspector:playgroundComplete':
      handlePlaygroundComplete(msg.runId, msg.ok, msg.errorMessage);
      break;
  }
});

let lastActiveAgentId = '';
let lastActiveEdgeKey = '';

/**
 * Handle a `inspector:diagramUpdate` message.
 *  - If `mermaidDsl` is non-empty: full re-render, then apply animation classes.
 *  - If `mermaidDsl` is empty: topology unchanged — only update animation classes.
 */
async function handleDiagramUpdate(msg) {
  if (msg.mermaidDsl) {
    await renderDiagram(msg.mermaidDsl);
  }
  if (msg.activeAgentId !== undefined) lastActiveAgentId = msg.activeAgentId ?? '';
  if (msg.activeEdgeKey !== undefined) lastActiveEdgeKey = msg.activeEdgeKey ?? '';
  applyAnimationClasses(lastActiveAgentId, lastActiveEdgeKey);
}

async function renderDiagram(dsl) {
  if (!dsl) return;
  if (dsl === currentDsl) return;
  currentDsl = dsl;

  const container = document.getElementById('insDiagram');
  if (!container) return;
  const id = `ins-mermaid-${++renderCounter}`;

  try {
    const { svg } = await mermaid.render(id, dsl);
    container.innerHTML = `<div class="mermaid">${svg}</div>`;
  } catch (e) {
    container.innerHTML =
      `<pre style="color:var(--error);padding:12px;font-size:11px;">` +
      `Diagram error:\n${escHtml(String(e))}\n\nDSL:\n${escHtml(dsl)}` +
      `</pre>`;
    console.error('[Agent Inspector] Mermaid render error:', e, '\nDSL:\n', dsl);
  }
}

/**
 * Mutate SVG class attributes for the active edge + running node.
 * No Mermaid re-render needed — just CSS class toggling.
 *
 * Mermaid edge id format: L-<from>-<to>-<n>
 * Mermaid node group id format: flowchart-<nodeId>-<n> (varies by version)
 *
 * We probe both the documented id pattern and walk all .edgePath elements
 * to find a fallback match by data attributes if the primary lookup misses.
 */
function applyAnimationClasses(activeAgentId, activeEdgeKey) {
  const container = document.getElementById('insDiagram');
  if (!container) return;
  const svg = container.querySelector('svg');
  if (!svg) return;

  // Clear previous marks
  svg.querySelectorAll('.ins-active, .ins-running').forEach((el) => {
    el.classList.remove('ins-active', 'ins-running');
  });

  if (!activeAgentId && !activeEdgeKey) return;

  // ── Active node (running) ──────────────────────────────────────────────
  if (activeAgentId) {
    // Mermaid renders node groups with id like "flowchart-<nodeId>-<n>"
    // Try direct id first, then fall back to attribute scan
    let nodeEl = svg.querySelector(`[id*="${activeAgentId}"]`);
    if (nodeEl) {
      // Find the closest <g class="node"> ancestor
      let el = nodeEl;
      while (el && !el.classList.contains('node')) {
        el = /** @type {Element} */ (el.parentElement);
      }
      el?.classList.add('ins-running');
    }
  }

  // ── Active edge (animated dashes) ──────────────────────────────────────
  if (activeEdgeKey) {
    // Primary: activeEdgeKey IS the Mermaid edge dom id (L-from-to-0)
    const edgeEl = svg.querySelector(`[id="${activeEdgeKey}"]`);
    if (edgeEl) {
      edgeEl.classList.add('ins-active');
    } else {
      // Fallback: walk all .edgePath elements — pick first that contains the
      // from/to nodeIds in its id attribute
      const parts = activeEdgeKey.split('-'); // L, from, to, n
      if (parts.length >= 3) {
        const from = parts[1];
        const to   = parts[2];
        svg.querySelectorAll('.edgePath').forEach((el) => {
          if (el.id.includes(from) && el.id.includes(to)) {
            el.classList.add('ins-active');
          }
        });
      }
    }
  }
}

function renderStepList(execution) {
  const list = document.getElementById('insStepList');
  if (!list) return;

  if (!execution || !execution.steps || execution.steps.length === 0) {
    list.innerHTML = `
      <div class="ins-empty">
        <p>No active workflow.</p>
        <p class="ins-hint">Start one with <code>@agent-studio /workflow full-feature-workflow</code></p>
      </div>`;
    return;
  }

  list.innerHTML = '';

  /** @type {Map<string, any[]>} */
  const phaseGroups = new Map();
  for (const step of execution.steps) {
    if (!phaseGroups.has(step.phase)) phaseGroups.set(step.phase, []);
    phaseGroups.get(step.phase).push(step);
  }

  for (const [phase, steps] of phaseGroups) {
    const header = document.createElement('div');
    header.className = 'ins-phase-header';
    header.textContent = phase;
    list.appendChild(header);

    for (const step of steps) {
      list.appendChild(buildStepItem(step, execution.currentStepId));
    }
  }
}

function buildStepItem(step, currentStepId) {
  const isActive = step.stepId === currentStepId;
  const el = document.createElement('div');
  el.className = `ins-step${isActive ? ' ins-step--active' : ''}`;
  el.dataset.stepId = step.stepId;

  const icon = STATUS_ICONS[step.status] ?? '?';
  const timing = formatTiming(step);

  el.innerHTML = `
    <span class="ins-step__icon ins-step__icon--${step.status}">${icon}</span>
    <div class="ins-step__body">
      <div class="ins-step__name" title="${escHtml(step.stepName)}">${escHtml(step.stepName)}</div>
      ${step.agentId ? `<div class="ins-step__agent">${escHtml(step.agentId)}</div>` : ''}
      ${timing ? `<div class="ins-step__timing">${timing}</div>` : ''}
      ${step.errorMessage ? `<div class="ins-step__error">${escHtml(step.errorMessage)}</div>` : ''}
    </div>
  `;
  return el;
}

function renderStatusPill(state, detail) {
  const pill = document.getElementById('insStatusPill');
  if (!pill) return;
  pill.className = `ins-status ins-status--${state}`;
  const label = pill.querySelector('.ins-status__label');
  if (label) label.textContent = formatStatusLabel(state, detail);
}

function formatStatusLabel(state, detail) {
  switch (state) {
    case 'running': return detail ? `Running · ${detail}` : 'Running';
    case 'failed':  return detail ? `Failed · ${detail}` : 'Failed';
    case 'connected': return 'Connected';
    case 'idle':
    default: return detail ?? 'Idle';
  }
}

const PG_LABELS = { user: 'You', assistant: 'Assistant', error: 'Error' };

let pgRunId = 0;
/** @type {string | null} */
let pgCurrentRunId = null;
/** @type {HTMLElement | null} */
let pgStreamingBubble = null;

function initPlayground() {
  const sendBtn   = document.getElementById('insPlaygroundSend');
  const cancelBtn = document.getElementById('insPlaygroundCancel');
  const input     = /** @type {HTMLTextAreaElement} */ (document.getElementById('insPlaygroundInput'));
  const target    = /** @type {HTMLSelectElement}   */ (document.getElementById('insPlaygroundTarget'));

  sendBtn?.addEventListener('click', () => sendPlayground());
  cancelBtn?.addEventListener('click', () => cancelPlayground());

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPlayground();
    }
  });
}

function sendPlayground() {
  const input  = /** @type {HTMLTextAreaElement} */ (document.getElementById('insPlaygroundInput'));
  const target = /** @type {HTMLSelectElement}   */ (document.getElementById('insPlaygroundTarget'));
  const prompt = input?.value.trim();
  if (!prompt) return;

  appendPlaygroundBubble('user', prompt);
  input.value = '';
  pgStreamingBubble = appendPlaygroundBubble('assistant', '');

  const runId = `pg-${++pgRunId}`;
  pgCurrentRunId = runId;
  setPlaygroundRunning(true);

  vscode.postMessage({
    type: 'inspector:runPlayground',
    runId,
    prompt,
    target: target?.value ?? 'model',
  });
}

function cancelPlayground() {
  if (!pgCurrentRunId) return;
  vscode.postMessage({ type: 'inspector:cancelPlayground', runId: pgCurrentRunId });
  pgCurrentRunId = null;
  setPlaygroundRunning(false);
}

function handlePlaygroundChunk(runId, chunk) {
  if (runId !== pgCurrentRunId) return;
  if (pgStreamingBubble) {
    pgStreamingBubble.textContent += chunk;
    pgStreamingBubble.scrollIntoView({ block: 'end' });
  }
}

function handlePlaygroundComplete(runId, ok, errorMessage) {
  if (runId !== pgCurrentRunId) return;
  pgCurrentRunId = null;
  pgStreamingBubble = null;
  setPlaygroundRunning(false);
  if (!ok && errorMessage) {
    appendPlaygroundBubble('error', errorMessage);
  }
}

/**
 * Add a chat bubble to the playground and return the text element
 * (so streaming can append to it).
 * @param {'user'|'assistant'|'error'} role
 * @param {string} text
 * @returns {HTMLElement}
 */
function appendPlaygroundBubble(role, text) {
  const messages = document.getElementById('insPlaygroundMessages');
  if (!messages) return document.createElement('div');

  const emptyEl = messages.querySelector('.ins-empty');
  if (emptyEl) emptyEl.remove();

  const wrap = document.createElement('div');
  wrap.className = `ins-pg-bubble ins-pg-bubble--${role}`;

  const label = document.createElement('div');
  label.className = 'ins-pg-bubble__label';
  label.textContent = PG_LABELS[role] ?? 'Assistant';
  wrap.appendChild(label);

  const content = document.createElement('div');
  content.className = 'ins-pg-bubble__text';
  content.textContent = text;
  wrap.appendChild(content);

  messages.appendChild(wrap);
  wrap.scrollIntoView({ block: 'end' });
  return content;
}

function setPlaygroundRunning(running) {
  const sendBtn   = /** @type {HTMLButtonElement} */ (document.getElementById('insPlaygroundSend'));
  const cancelBtn = /** @type {HTMLButtonElement} */ (document.getElementById('insPlaygroundCancel'));
  if (sendBtn)   sendBtn.disabled   = running;
  if (cancelBtn) cancelBtn.disabled = !running;
}

const MAX_EVENT_ROWS = 500;

/** @type {string[]} Active event type filters (empty = all). */
const activeFilters = new Set();

const EVENT_ICONS = {
  'workflow:started':   '▶',
  'workflow:completed': '✓',
  'workflow:failed':    '✗',
  'phase:entered':      '⬡',
  'step:running':       '▶',
  'step:done':          '✓',
  'step:error':         '✗',
  'step:skipped':       '—',
  'agent:message':      '💬',
  'tool:invoked':       '🔧',
  'tool:completed':     '✅',
};

const EVENT_COLORS = {
  'workflow:started':   '#58a6ff',
  'workflow:completed': '#2ea043',
  'workflow:failed':    '#f85149',
  'phase:entered':      '#d2a8ff',
  'step:running':       '#3fb950',
  'step:done':          '#2ea043',
  'step:error':         '#f85149',
  'step:skipped':       '#666',
  'agent:message':      '#79c0ff',
  'tool:invoked':       '#e3b341',
  'tool:completed':     '#56d364',
};

/**
 * Append a single event row to the Events tab.
 * @param {any} event
 * @param {any} [message]
 * @param {any} [tool]
 */
function appendEvent(event, message, tool) {
  const list = document.getElementById('insEventList');
  if (!list) return;

  const emptyEl = list.querySelector('.ins-empty');
  if (emptyEl) emptyEl.remove();

  // Evict oldest rows when the list exceeds the cap
  while (list.querySelectorAll('.ins-event-row').length >= MAX_EVENT_ROWS) {
    list.querySelector('.ins-event-row')?.remove();
  }

  const row = document.createElement('div');
  row.className = 'ins-event-row';
  row.dataset.eventType = event.type;

  const icon  = EVENT_ICONS[event.type] ?? '·';
  const color = EVENT_COLORS[event.type] ?? 'var(--muted)';
  const ts    = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  let detail = '';
  if (message) {
    const preview = message.text.slice(0, 120).replace(/\n/g, ' ');
    detail = `<div class="ins-event__detail">[${message.role}] ${escHtml(preview)}${message.text.length > 120 ? '…' : ''}</div>`;
  } else if (tool) {
    detail = `<div class="ins-event__detail">${escHtml(tool.name)} (${tool.kind})</div>`;
  } else if (event.payload?.kind === 'step') {
    detail = `<div class="ins-event__detail">${escHtml(event.stepId ?? '')}</div>`;
  } else if (event.payload?.kind === 'phase') {
    detail = `<div class="ins-event__detail">${escHtml(String(event.payload.phase ?? ''))}</div>`;
  }

  row.innerHTML = `
    <span class="ins-event__icon" style="color:${color}">${icon}</span>
    <div class="ins-event__body">
      <div class="ins-event__type">${escHtml(event.type)}</div>
      ${detail}
    </div>
    <span class="ins-event__ts">${ts}</span>
  `;

  list.appendChild(row);
  // Auto-scroll if near bottom
  if (list.scrollHeight - list.scrollTop < list.clientHeight + 80) {
    list.scrollTop = list.scrollHeight;
  }
}

let ioExecutionId = null;
let ioRenderedCount = 0;

/** @param {any} execution */
function renderIO(execution) {
  const panel = document.getElementById('insIOContent');
  if (!panel) return;

  const messages = execution?.messages ?? [];

  if (execution?.id !== ioExecutionId) {
    panel.innerHTML = '';
    ioRenderedCount = 0;
    ioExecutionId = execution?.id ?? null;
  }

  if (messages.length === 0) {
    if (!panel.querySelector('.ins-io-empty')) {
      panel.innerHTML = `<div class="ins-io-empty">No messages recorded yet.</div>`;
    }
    return;
  }

  panel.querySelector('.ins-io-empty')?.remove();

  for (let i = ioRenderedCount; i < messages.length; i++) {
    panel.appendChild(buildIOMsgEl(messages[i]));
  }
  ioRenderedCount = messages.length;
}

/** @param {any} msg */
function buildIOMsgEl(msg) {
  const el = document.createElement('div');
  el.className = `ins-io-msg ins-io-msg--${msg.direction}`;
  const roleLabel = `${msg.role} (${msg.direction})`;
  const preview   = msg.text.length > 2000 ? msg.text.slice(0, 2000) + '\n…(truncated)' : msg.text;
  el.innerHTML = `
    <div class="ins-io-msg__header">
      <span class="ins-io-msg__role">${escHtml(roleLabel)}</span>
      ${msg.agentId ? `<span class="ins-io-msg__agent">${escHtml(msg.agentId)}</span>` : ''}
      <span class="ins-io-msg__ts">${new Date(msg.timestamp).toLocaleTimeString()}</span>
    </div>
    <pre class="ins-io-msg__text">${escHtml(preview)}</pre>
  `;
  return el;
}

function initFrameworkDropdown() {
  const dropdown = /** @type {HTMLSelectElement} */ (document.getElementById('insFrameworkDropdown'));
  const runBtn   = /** @type {HTMLButtonElement} */ (document.getElementById('insRunBtn'));

  dropdown?.addEventListener('change', () => {
    const val = dropdown.value;
    if (runBtn) runBtn.disabled = !val;
    vscode.postMessage({ type: 'inspector:selectFramework', pluginName: val || null });
  });

  runBtn?.addEventListener('click', () => {
    const val = dropdown?.value;
    if (!val) return;
    vscode.postMessage({ type: 'inspector:runFramework', pluginName: val });
  });
}

/** @param {Array<{pluginName:string, displayName:string}>} frameworks */
function updateFrameworkDropdown(frameworks) {
  const dropdown = /** @type {HTMLSelectElement} */ (document.getElementById('insFrameworkDropdown'));
  if (!dropdown) return;

  while (dropdown.options.length > 1) dropdown.remove(1);

  for (const fw of frameworks) {
    const opt = document.createElement('option');
    opt.value = fw.pluginName;
    opt.textContent = fw.displayName;
    dropdown.appendChild(opt);
  }
}

const TOOL_KIND_ICONS = {
  'skill-injection':       '🔧',
  'instruction-injection': '📖',
  'mcp-call':              '🔌',
  'hook':                  '⚡',
  'custom':                '⚙️',
};

/** @param {any} execution */
function renderTools(execution) {
  const list = document.getElementById('insToolsList');
  if (!list) return;

  const tools = execution?.tools ?? [];
  if (tools.length === 0) {
    list.innerHTML = `
      <div class="ins-tools-empty">
        <p>No tools invoked yet.</p>
        <p class="ins-placeholder__muted">Tool/skill invocations appear here as the workflow runs.</p>
      </div>`;
    return;
  }

  list.innerHTML = '';

  /** @type {Map<string, any[]>} */
  const byStep = new Map();
  for (const tool of tools) {
    const key = tool.stepId ?? '__no_step__';
    if (!byStep.has(key)) byStep.set(key, []);
    byStep.get(key).push(tool);
  }

  for (const [stepId, stepTools] of byStep) {
    if (stepId !== '__no_step__') {
      const header = document.createElement('div');
      header.className = 'ins-tools-step-header';
      header.textContent = `Step: ${stepId}`;
      list.appendChild(header);
    }

    for (const tool of stepTools) {
      list.appendChild(buildToolRow(tool));
    }
  }
}

/** @param {any} tool */
function buildToolRow(tool) {
  const wrap = document.createElement('div');
  wrap.className = 'ins-tool-row';

  const icon = TOOL_KIND_ICONS[tool.kind] ?? '⚙️';
  const elapsed = tool.completedAt && tool.startedAt
    ? `${tool.completedAt - tool.startedAt}ms`
    : tool.startedAt ? 'running…' : '';
  const statusClass = tool.error ? 'ins-tool-row--error' : tool.completedAt ? 'ins-tool-row--done' : '';
  if (statusClass) wrap.classList.add(statusClass);

  wrap.innerHTML = `
    <div class="ins-tool-row__header">
      <span class="ins-tool-row__icon">${icon}</span>
      <span class="ins-tool-row__name">${escHtml(tool.name)}</span>
      <span class="ins-tool-row__kind">${escHtml(tool.kind)}</span>
      ${elapsed ? `<span class="ins-tool-row__timing">${elapsed}</span>` : ''}
    </div>
    ${tool.error ? `<div class="ins-tool-row__error">${escHtml(tool.error)}</div>` : ''}
    ${tool.result !== undefined ? `
      <details class="ins-tool-row__details">
        <summary>Result</summary>
        <pre>${escHtml(JSON.stringify(tool.result, null, 2))}</pre>
      </details>` : ''}
  `;

  return wrap;
}

const STATUS_ICONS = {
  pending: '⏳',
  running: '▶',
  done: '✓',
  error: '✗',
  skipped: '—',
};

function formatTiming(step) {
  if (!step.startedAt) return '';
  const end = step.completedAt ?? Date.now();
  const ms = end - step.startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
