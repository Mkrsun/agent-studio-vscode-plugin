import { Button, EmptyState, Loading, Tag, TypeBadge } from '../../shared/ui';
import type { CatalogAsset } from '../../protocol';
import { type AssetsApi } from './useAssets';

export function AssetsTab({ api }: { api: AssetsApi }): JSX.Element {
  if (!api.loaded) return <Loading>Loading assets…</Loading>;
  if (api.catalog.length === 0) return <EmptyState>No assets match your search.</EmptyState>;
  return (
    <div className="mp-grid">
      {api.catalog.map((asset) => (
        <AssetCard key={asset.id} asset={asset} api={api} />
      ))}
    </div>
  );
}

function AssetCard({ asset, api }: { asset: CatalogAsset; api: AssetsApi }): JSX.Element {
  const s = api.stateOf(asset.id);
  return (
    <div className="asset-card">
      <div className="asset-card__header">
        <TypeBadge type={asset.type} />
        <span className="asset-card__name">{asset.name}</span>
      </div>
      <p className="asset-card__description">{asset.description}</p>
      <div className="asset-card__tags">
        {(asset.tags ?? []).slice(0, 3).map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>
      <div className="asset-card__meta">
        <span>
          v{asset.version}
          {s.installed && s.installedVersion && s.installedVersion !== asset.version
            ? ` (installed v${s.installedVersion})`
            : ''}
        </span>
        <span>{asset.source}</span>
      </div>

      <div className="asset-card__actions">
        {/* Two states. Not installed → Install only. Installed → Update (when
            available) + Uninstall (danger). Preview is always available. */}
        {!s.installed ? (
          <Button variant="primary" title="Install to .github/" onClick={() => api.install(asset.id)}>
            ↓ Install
          </Button>
        ) : (
          <>
            {s.hasUpdate && (
              <Button
                variant="warning"
                title={`Update to v${s.availableVersion ?? ''}`}
                onClick={() => api.update(asset.id)}
              >
                ↑ Update
              </Button>
            )}
            <Button variant="danger" title="Uninstall from .github/" onClick={() => api.uninstall(asset.id)}>
              ✕ Uninstall
            </Button>
          </>
        )}
        <Button variant="secondary" onClick={() => api.preview(asset.id)}>
          Preview
        </Button>
      </div>

      {/* Per-asset auto-update (off by default), only relevant once installed. */}
      {s.installed && (
        <label
          className="asset-card__autoupdate"
          title="Automatically re-export this asset when a newer version is published"
        >
          <input
            type="checkbox"
            checked={s.autoUpdate}
            onChange={(e) => api.setAutoUpdate(asset.id, e.target.checked)}
          />
          Auto-update
        </label>
      )}
    </div>
  );
}
