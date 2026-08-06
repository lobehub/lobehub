import { useEffect, useState } from 'react';

import type { EditorBridge } from './type';

/**
 * The footer must not act before the lazily-loaded content half has produced an
 * editor: reading a missing one yields an empty document, which the caller then
 * saves over its own value.
 */
export const useEditorBridgeReady = (bridge: EditorBridge) => {
  const [ready, setReady] = useState(() => Boolean(bridge.current));

  useEffect(() => {
    if (bridge.current) {
      setReady(true);
      return;
    }
    bridge.notifyReady = () => setReady(true);
    return () => {
      bridge.notifyReady = undefined;
    };
  }, [bridge]);

  return ready;
};
