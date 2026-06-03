import { useEffect, useRef } from 'react';
import type { HostMessage } from '../protocol';

/**
 * Subscribe to typed messages from the extension host. The handler can change
 * between renders (kept in a ref) without re-subscribing the window listener.
 */
export function useMessages(handler: (msg: HostMessage) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (e: MessageEvent): void => ref.current(e.data as HostMessage);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
}
