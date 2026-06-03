import { useCallback, useReducer } from 'react';
import { useMessages } from '../../platform/useMessages';
import type { CopilotExtension, HostMessage } from '../../protocol';

interface State {
  extensions: CopilotExtension[];
  loaded: boolean;
}

export interface ExtensionsApi {
  extensions: CopilotExtension[];
  loaded: boolean;
}

export function useExtensions(): ExtensionsApi {
  const [state, dispatch] = useReducer(
    (_s: State, a: { extensions: CopilotExtension[] }): State => ({ extensions: a.extensions, loaded: true }),
    { extensions: [], loaded: false },
  );

  useMessages(
    useCallback((msg: HostMessage) => {
      if (msg.type === 'marketplace:loadExtensions') dispatch({ extensions: msg.extensions });
    }, []),
  );

  return state;
}
