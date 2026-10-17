import { useCallback, useState } from 'react';

import { useChatStore } from '@/store/chat';
import { getPendingTopicRepos, setPendingTopicRepos } from '@/store/chat/pendingTopicRepos';
import { topicSelectors } from '@/store/chat/selectors';

import { useTopicId } from '../hooks/useTopicId';

/**
 * The cloud repos selected for this composer's conversation, and the toggle
 * that edits them.
 *
 * The topic is the composer's own (see `useTopicId`), never the global active
 * topic: a side-by-side pane must not toggle the main column's repos. Before a
 * topic exists the selection is buffered by agent and carried by the first send.
 */
export const useTopicRepoSelection = (agentId: string, canEdit: boolean) => {
  // Incremented to trigger re-renders when the module-singleton pending selection changes.
  const [, forceUpdate] = useState(0);

  const topicId = useTopicId();
  // Repos persisted to the topic (empty when no topic or none set)
  const topicRepos: string[] = useChatStore(
    (s) => (topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata?.repos : undefined) ?? [],
  );
  const currentWorkingDirectory = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata?.workingDirectory : undefined,
  );
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);

  const toggleRepo = useCallback(
    async (repo: string) => {
      if (!canEdit) return;

      if (!topicId) {
        // No topic yet — buffer in the module singleton keyed by agentId.
        // gateway.ts will read and consume this when the first message creates a topic.
        const prev = getPendingTopicRepos(agentId);
        const isSelected = prev.includes(repo);
        const next = isSelected ? prev.filter((r) => r !== repo) : [...prev, repo];
        setPendingTopicRepos(agentId, next);
        forceUpdate((v) => v + 1);
        return;
      }

      const isSelected = topicRepos.includes(repo);
      const nextRepos = isSelected ? topicRepos.filter((r) => r !== repo) : [...topicRepos, repo];

      // Only set workingDirectory when it hasn't been assigned yet (first selection).
      // Once set, it stays fixed so the topic keeps its sidebar grouping.
      const patch: {
        repos: string[];
        workingDirectory?: string;
        workingDirectoryConfig?: { path: string; repoType: 'github' };
      } = { repos: nextRepos };
      if (!currentWorkingDirectory && nextRepos.length > 0) {
        patch.workingDirectory = nextRepos[0];
        patch.workingDirectoryConfig = { path: nextRepos[0], repoType: 'github' };
      }

      await updateTopicMetadata(topicId, patch);
    },
    [agentId, canEdit, currentWorkingDirectory, topicId, topicRepos, updateTopicMetadata],
  );

  // When a topic exists, show its persisted repos.
  // When no topic exists yet, show the pending selection from the module singleton.
  const displayRepos = topicId ? topicRepos : getPendingTopicRepos(agentId);

  return { displayRepos, toggleRepo };
};
