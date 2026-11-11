import debug from 'debug';
import { useEffect, useMemo } from 'react';

import {
  agentDocumentActions,
  agentDocumentSelectors,
  useAgentDocumentStore,
} from '@/store/agentDocument';

const log = debug('lobe-chat:useDocumentChatTopic');

/**
 * Resolve the doc-anchored chat topic for an `(agentId, documentId)` pair.
 *
 * Backed by the `agentDocumentChatTopic` replica over
 * `agentDocument.getOrCreateChatTopic`, which is idempotent and marks the topic
 * with `trigger='document'` so it is filtered out of the regular chat sidebar.
 * The first call provisions the topic + the `topic_documents` association;
 * subsequent calls return the same topic id. The resolved id is persisted, so a
 * reload paints the panel's conversation before the server confirms it.
 *
 * Returns `topicId: undefined` until an id is known; callers should gate
 * rendering on a non-undefined value to avoid mounting a chat panel without a
 * topic anchor.
 */
export const useDocumentChatTopic = (params: {
  agentId: string | undefined;
  documentId: string | undefined;
}) => {
  const { agentId, documentId } = params;
  const enabled = !!agentId && !!documentId;
  const replicaParams = useMemo(
    () => (agentId && documentId ? { agentId, documentId } : null),
    [agentId, documentId],
  );
  const { error, isHydrated, isValidating } =
    agentDocumentActions.useFetchDocumentChatTopic(replicaParams);
  const topicId = useAgentDocumentStore(
    agentDocumentSelectors.getDocumentChatTopicId(replicaParams),
  );

  useEffect(() => {
    if (!enabled) {
      log('skipped — agentId=%o documentId=%o', agentId, documentId);
      return;
    }
    if (error) {
      // Surface to the regular console as well so the panel's silent gating
      // doesn't hide a real procedure failure (e.g. NOT_FOUND when the agent
      // doesn't own the document).
      console.error('[useDocumentChatTopic] getOrCreateChatTopic failed', {
        agentId,
        documentId,
        error,
      });
      return;
    }
    if (topicId) log('resolved topicId=%s for (%s, %s)', topicId, agentId, documentId);
  }, [enabled, agentId, documentId, topicId, error]);

  return {
    error,
    isLoading: enabled && !topicId && !error && (!isHydrated || isValidating),
    topicId,
  };
};
