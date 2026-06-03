import { useCallback, useReducer } from 'react';
import { useMessages } from '../../platform/useMessages';
import { post } from '../../platform/vscodeApi';
import type { HostMessage, McpServer } from '../../protocol';

interface State {
  servers: McpServer[];
  loaded: boolean;
  installed: Record<string, boolean>;
}

type Action =
  | { kind: 'loaded'; servers: McpServer[] }
  | { kind: 'state'; serverId: string; installed: boolean };

function reducer(s: State, a: Action): State {
  switch (a.kind) {
    case 'loaded':
      return { ...s, servers: a.servers, loaded: true };
    case 'state':
      return { ...s, installed: { ...s.installed, [a.serverId]: a.installed } };
  }
}

export interface McpApi {
  servers: McpServer[];
  loaded: boolean;
  isInstalled: (id: string) => boolean;
  install: (id: string) => void;
}

export function useMcp(): McpApi {
  const [state, dispatch] = useReducer(reducer, { servers: [], loaded: false, installed: {} });

  useMessages(
    useCallback((msg: HostMessage) => {
      if (msg.type === 'marketplace:loadMcp') dispatch({ kind: 'loaded', servers: msg.servers });
      else if (msg.type === 'marketplace:mcpState') dispatch({ kind: 'state', serverId: msg.serverId, installed: msg.installed });
    }, []),
  );

  return {
    servers: state.servers,
    loaded: state.loaded,
    isInstalled: (id) => state.installed[id] ?? false,
    install: (id) => post({ type: 'marketplace:installMcp', serverId: id }),
  };
}
