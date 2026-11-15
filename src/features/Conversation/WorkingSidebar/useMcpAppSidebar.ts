import { useEffect } from 'react';

import { mcpAppActions } from '@/store/mcpApp/action';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import type { ComposerTarget } from '../types';

/** Mounted by the sidebar shell, even while its content is collapsed. */
export const useMcpAppSidebar = (target: ComposerTarget) => {
  const enabled = useServerConfigStore(serverConfigSelectors.enableMcpApps);
  const scope = target.writable ? target.contextKey : undefined;
  useEffect(() => {
    if (enabled && scope) return mcpAppActions.registerPanel(scope);
  }, [enabled, scope]);
  return { enabled };
};
