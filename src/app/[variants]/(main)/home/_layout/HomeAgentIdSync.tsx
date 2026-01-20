import { useUnmount } from 'ahooks';
import { createStoreUpdater } from 'zustand-utils';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

const HomeAgentIdSync = () => {
  const useAgentStoreUpdater = createStoreUpdater(useAgentStore);

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  // Sync inbox agent id to activeAgentId when on home page
  useAgentStoreUpdater('activeAgentId', inboxAgentId);

  // Clear activeAgentId when unmounting (leaving home page)
  useUnmount(() => {
    useAgentStore.setState({ activeAgentId: undefined });
  });

  return null;
};

export default HomeAgentIdSync;
