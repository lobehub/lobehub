import debug from 'debug';
import { useEffect } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';

const log = debug('lobe-chat:useDocumentChatTopic');

/**
 * Resolve the doc-anchored chat topic for an `(agentId, documentId)` pair.
 *
 * Backed by `agentDocument.getOrCreateChatTopic`, which is idempotent and
 * marks the topic with `trigger='document'` so it is filtered out of the
 * regular chat sidebar. The first call provisions the topic + the
 * `topic_documents` association; subsequent calls return the same topic id.
 *
 * Returns `topicId: undefined` until the request resolves; callers should gate
 * rendering on a non-undefined value to avoid mounting a chat panel without a
 * topic anchor.
 */
export const useDocumentChatTopic = (params: {
  agentId: string | undefined;
  documentId: string | undefined;
}) => {
  const { agentId, documentId } = params;
  const enabled = !!agentId && !!documentId;
  const { data, error, isLoading } = useClientDataSWR(
    enabled ? agentDocumentSWRKeys.documentChatTopic(agentId, documentId) : null,
    () =>
      agentDocumentService.getOrCreateChatTopic({
        agentId: agentId!,
        documentId: documentId!,
      }),
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
    if (data?.topicId) log('resolved topicId=%s for (%s, %s)', data.topicId, agentId, documentId);
  }, [enabled, agentId, documentId, data?.topicId, error]);

  return { error, isLoading, topicId: data?.topicId };
};
