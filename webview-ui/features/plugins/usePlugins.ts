import { useCallback, useReducer } from 'react';
import { useMessages } from '../../platform/useMessages';
import { post } from '../../platform/vscodeApi';
import type { HostMessage, PluginGroup } from '../../protocol';

interface State {
  groups: PluginGroup[];
  loading: boolean;
  installed: Record<string, boolean>;
}

type Action =
  | { kind: 'loading' }
  | { kind: 'loaded'; groups: PluginGroup[] }
  | { kind: 'state'; name: string; installed: boolean };

function reducer(s: State, a: Action): State {
  switch (a.kind) {
    case 'loading':
      return { ...s, loading: true, groups: [] };
    case 'loaded':
      return { ...s, loading: false, groups: a.groups };
    case 'state':
      return { ...s, installed: { ...s.installed, [a.name]: a.installed } };
  }
}

export interface PluginsApi {
  groups: PluginGroup[];
  loading: boolean;
  isInstalled: (name: string, fallback?: boolean) => boolean;
  install: (name: string, marketplaceId: string) => void;
  uninstall: (name: string) => void;
  addMarketplace: () => void;
  refresh: () => void;
}

export function usePlugins(): PluginsApi {
  const [state, dispatch] = useReducer(reducer, { groups: [], loading: true, installed: {} });

  useMessages(
    useCallback((msg: HostMessage) => {
      if (msg.type === 'marketplace:pluginsLoading') dispatch({ kind: 'loading' });
      else if (msg.type === 'marketplace:loadPlugins') dispatch({ kind: 'loaded', groups: msg.groups });
      else if (msg.type === 'marketplace:pluginState') dispatch({ kind: 'state', name: msg.pluginName, installed: msg.installed });
    }, []),
  );

  return {
    groups: state.groups,
    loading: state.loading,
    isInstalled: (name, fallback = false) => state.installed[name] ?? fallback,
    install: (name, marketplaceId) => post({ type: 'marketplace:installPlugin', pluginName: name, marketplaceId }),
    uninstall: (name) => post({ type: 'marketplace:uninstallPlugin', pluginName: name }),
    addMarketplace: () => post({ type: 'marketplace:addMarketplace' }),
    refresh: () => post({ type: 'marketplace:refreshPlugins' }),
  };
}
