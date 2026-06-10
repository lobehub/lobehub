import { useLayoutEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

const HomeAgentIdSync = () => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  // Sync inbox agent id to activeAgentId when on home page. Layout effect (not
  // passive) so it stays ordered with AgentIdSync's layout-effect clear/backfill:
  // in a single route-switch commit, removed-tree layout cleanups always run
  // before new-tree layout effects.
  useLayoutEffect(() => {
    if (!inboxAgentId) return;

    if (useAgentStore.getState().activeAgentId !== inboxAgentId)
      useAgentStore.setState({ activeAgentId: inboxAgentId }, false, 'HomeAgentIdSync/syncAgentId');
  }, [inboxAgentId]);

  // Clear activeAgentId when unmounting (leaving home page) — layout cleanup
  // for the same ordering reason as above.
  useLayoutEffect(
    () => () => {
      useAgentStore.setState({ activeAgentId: undefined }, false, 'HomeAgentIdSync/unmountAgentId');
    },
    [],
  );

  return null;
};

export default HomeAgentIdSync;
