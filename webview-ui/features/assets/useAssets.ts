import { useCallback, useReducer } from 'react';
import { useMessages } from '../../platform/useMessages';
import { post } from '../../platform/vscodeApi';
import type { CatalogAsset, AssetState, HostMessage } from '../../protocol';

interface State {
  catalog: CatalogAsset[];
  loaded: boolean;
  states: Record<string, AssetState>;
}

type Action =
  | { kind: 'catalog'; assets: CatalogAsset[] }
  | { kind: 'state'; assetId: string; state: AssetState };

function reducer(s: State, a: Action): State {
  switch (a.kind) {
    case 'catalog':
      return { ...s, catalog: a.assets, loaded: true };
    case 'state':
      return { ...s, states: { ...s.states, [a.assetId]: a.state } };
  }
}

const DEFAULT_STATE: AssetState = { installed: false, hasUpdate: false };

export interface AssetsApi {
  catalog: CatalogAsset[];
  loaded: boolean;
  stateOf: (id: string) => AssetState;
  install: (id: string) => void;
  update: (id: string) => void;
  uninstall: (id: string) => void;
  preview: (id: string) => void;
  filterChange: (query: string, assetType: string) => void;
}

export function useAssets(): AssetsApi {
  const [state, dispatch] = useReducer(reducer, { catalog: [], loaded: false, states: {} });

  useMessages(
    useCallback((msg: HostMessage) => {
      if (msg.type === 'marketplace:loadCatalog') {
        dispatch({ kind: 'catalog', assets: msg.assets });
      } else if (msg.type === 'marketplace:assetState') {
        dispatch({
          kind: 'state',
          assetId: msg.assetId,
          state: {
            installed: msg.installed,
            hasUpdate: msg.hasUpdate,
            installedVersion: msg.installedVersion,
            availableVersion: msg.availableVersion,
          },
        });
      }
    }, []),
  );

  return {
    catalog: state.catalog,
    loaded: state.loaded,
    stateOf: (id) => state.states[id] ?? DEFAULT_STATE,
    install: (id) => post({ type: 'marketplace:install', assetId: id }),
    update: (id) => post({ type: 'marketplace:update', assetId: id }),
    uninstall: (id) => post({ type: 'marketplace:uninstall', assetId: id }),
    preview: (id) => post({ type: 'marketplace:preview', assetId: id }),
    filterChange: (query, assetType) => post({ type: 'marketplace:filterChange', query, assetType }),
  };
}

/** Button appearance + action from asset state: Install → Installed → Update. */
export function assetButton(s: AssetState): {
  variant: 'primary' | 'success' | 'warning';
  label: string;
  title: string;
  action: 'install' | 'uninstall' | 'update';
} {
  if (s.hasUpdate) return { variant: 'warning', label: '↑ Update', title: `Update to v${s.availableVersion ?? ''}`, action: 'update' };
  if (s.installed) return { variant: 'success', label: '✓ Installed', title: 'Uninstall from .github/', action: 'uninstall' };
  return { variant: 'primary', label: '↓ Install', title: 'Install to .github/', action: 'install' };
}
