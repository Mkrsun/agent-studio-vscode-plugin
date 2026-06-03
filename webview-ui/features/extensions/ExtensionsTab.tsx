import { Tag, TypeBadge } from '../../shared/ui';
import type { CopilotExtension } from '../../protocol';
import type { ExtensionsApi } from './useExtensions';

export function ExtensionsTab({ api }: { api: ExtensionsApi }): JSX.Element {
  const byCategory = groupByCategory(api.extensions);
  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        GitHub Copilot Extensions are GitHub Apps that add <code>@extension-name</code> participants to your
        Copilot Chat. Install them on GitHub.com and they appear automatically.
      </p>
      {Object.entries(byCategory).map(([category, exts]) => (
        <div key={category}>
          <div className="section-header">{category}</div>
          <div className="mp-grid" style={{ marginBottom: 16 }}>
            {exts.map((ext) => <ExtensionCard key={ext.name} ext={ext} />)}
          </div>
        </div>
      ))}
    </>
  );
}

function groupByCategory(exts: CopilotExtension[]): Record<string, CopilotExtension[]> {
  const out: Record<string, CopilotExtension[]> = {};
  for (const e of exts) (out[e.category] ??= []).push(e);
  return out;
}

function ExtensionCard({ ext }: { ext: CopilotExtension }): JSX.Element {
  const official = ext.tags?.includes('official');
  const tags = (ext.tags ?? []).filter((t) => t !== 'official').slice(0, 3);
  return (
    <div className="ext-card">
      <div className="ext-card__header">
        <TypeBadge type="extension" label="Extension" />
        <div style={{ flex: 1 }}>
          <div className="ext-card__name">
            {ext.name} {official && <Tag official>official</Tag>}
          </div>
          <div className="ext-card__publisher">{ext.publisher}</div>
        </div>
      </div>
      <p className="asset-card__description">{ext.description}</p>
      <div className="asset-card__tags">{tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
      <div className="asset-card__actions">
        <a href={ext.marketplaceUrl} className="btn btn-external" target="_blank" rel="noreferrer">
          Install on GitHub ↗
        </a>
      </div>
      <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
        After installing on GitHub, use <code>@{ext.name.toLowerCase()}</code> in Copilot Chat
      </p>
    </div>
  );
}
