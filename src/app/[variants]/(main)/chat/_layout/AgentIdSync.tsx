import { useUnmount } from 'ahooks';
import { useParams } from 'react-router-dom';
import { createStoreUpdater } from 'zustand-utils';

import { INBOX_SESSION_ID } from '@/const/session';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

const AgentIdSync = () => {
  const useStoreUpdater = createStoreUpdater(useAgentStore);
  const useChatStoreUpdater = createStoreUpdater(useChatStore);
  const params = useParams<{ aid?: string }>();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  const resolvedAgentId =
    params.aid === INBOX_SESSION_ID ? inboxAgentId ?? undefined : params.aid;

  useStoreUpdater('activeAgentId', resolvedAgentId);
  useChatStoreUpdater('activeAgentId', resolvedAgentId ?? '');

  // Clear activeAgentId when unmounting (leaving chat page)
  useUnmount(() => {
    useAgentStore.setState({ activeAgentId: undefined });
    useChatStore.setState({ activeAgentId: undefined, activeTopicId: undefined });
  });

  return null;
};

export default AgentIdSync;
