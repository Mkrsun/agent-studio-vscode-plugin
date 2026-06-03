import { Button, EmptyState, Loading, Tag, TypeBadge } from '../../shared/ui';
import type { CatalogAsset } from '../../protocol';
import { assetButton, type AssetsApi } from './useAssets';

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
  const b = assetButton(api.stateOf(asset.id));
  const onAction = (): void => {
    if (b.action === 'update') api.update(asset.id);
    else if (b.action === 'uninstall') api.uninstall(asset.id);
    else api.install(asset.id);
  };
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
        <span>v{asset.version}</span>
        <span>{asset.source}</span>
      </div>
      <div className="asset-card__actions">
        <Button variant={b.variant} title={b.title} onClick={onAction}>
          {b.label}
        </Button>
        <Button variant="secondary" onClick={() => api.preview(asset.id)}>
          Preview
        </Button>
      </div>
    </div>
  );
}
