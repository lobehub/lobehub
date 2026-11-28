import { memo } from 'react';

import { useFetchTopicMemories } from '@/hooks/useFetchMemoryForTopic';
import { useAgentStore } from '@/store/agent';
import { useNotebookStore } from '@/store/notebook';
import { useUserStore } from '@/store/user';
import { authSelectors, settingsSelectors } from '@/store/user/selectors';

import { useConversationStore } from '../../store';

/**
 * Starts the side-data syncs a conversation needs (agent config, notebook
 * documents, topic memories) without rendering anything.
 *
 * These syncs live in their own leaf on purpose: every sync hook re-renders its
 * caller on each fetch-lifecycle flip (hydrated, validating, settled). Called
 * from the message list, each flip re-rendered the whole list on first open.
 * Here a flip only re-renders this null leaf.
 */
export const useConversationContextSync = () => {
  const agentId = useConversationStore((s) => s.context.agentId);
  const topicId = useConversationStore((s) => s.context.topicId);
  // Topic shares may be anonymous, and agent-share visitors are not the owner
  // the notebook and memory APIs scope to.
  const isSharePage = useConversationStore(
    (s) => !!s.context.topicShareId || !!s.context.agentShareId,
  );
  const isAgentShareVisitor = useConversationStore((s) => !!s.context.agentShareId);
  const isLogin = useUserStore(authSelectors.isLogin);
  const enableUserMemories = useUserStore(settingsSelectors.memoryEnabled);

  // Loads this conversation's agent meta so message author titles resolve via
  // useAgentMeta instead of "Untitled Agent". Route layouts only init the
  // active agent; secondary mounts (e.g. the share page) never do. SWR dedupes
  // against the route-level init. Agent-share visitors skip it: the
  // owner-scoped API resolves to null and `markAgentNotFound` would wipe the
  // share-seeded agentMap entry.
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  useFetchAgentConfig(isLogin && !isAgentShareVisitor, agentId);

  // The agent-document list is intentionally not pre-warmed here: nothing in
  // the message list renders it, and the surfaces that do fetch on mount.
  const useFetchDocuments = useNotebookStore((s) => s.useFetchDocuments);
  useFetchDocuments(isSharePage ? undefined : (topicId ?? undefined));
  useFetchTopicMemories(enableUserMemories && !isSharePage ? topicId : undefined);
};

const ConversationContextLoader = memo(() => {
  useConversationContextSync();
  return null;
});

ConversationContextLoader.displayName = 'ConversationContextLoader';

export default ConversationContextLoader;
