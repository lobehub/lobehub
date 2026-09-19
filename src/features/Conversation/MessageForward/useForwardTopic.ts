import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import type { ForwardTarget } from '@/store/chat/slices/forward/action';

interface ForwardTopicSource {
  agentId: string;
  cancelSourceContinuation?: boolean;
  topicId: string;
}

export const useForwardTopic = ({
  agentId,
  cancelSourceContinuation,
  topicId,
}: ForwardTopicSource) => {
  const { t } = useTranslation('chat');

  const navigate = useWorkspaceAwareNavigate();
  const forwardTopic = useChatStore((s) => s.forwardTopic);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  return useCallback(
    (targets: ForwardTarget[], note?: string) => {
      if (targets.length === 0) return;

      const primaryTarget = targets[0];
      void forwardTopic({
        cancelSourceContinuation,
        header: t('messageForward.topic.header'),
        note,
        onTopicCreated: (target, createdTopicId) => {
          if (target.id !== primaryTarget.id) return;
          clearPortalStack();
          navigate(AGENT_CHAT_TOPIC_URL(target.id, createdTopicId));
        },
        roleLabel: (role) =>
          role === 'user' ? t('messageForward.role.user') : t('messageForward.role.assistant'),
        sourceAgentId: agentId,
        targets,
        topicId,
      })
        .then((result) => {
          if (result.succeeded.length > 0) {
            toast.success(
              targets.length === 1
                ? t('messageForward.success', { title: primaryTarget.title || '' })
                : t('messageForward.successMulti', { count: result.succeeded.length }),
            );
          }
          if (result.failed.length > 0)
            toast.error(
              t(
                result.sourceSchedulePaused
                  ? 'messageForward.topic.sourceSchedulePaused'
                  : 'messageForward.failed',
              ),
            );
        })
        .catch((error) => {
          console.error('[useForwardTopic] Forwarding failed:', error);
          toast.error(
            t(
              cancelSourceContinuation
                ? 'messageForward.topic.handoffFailed'
                : 'messageForward.topic.loadFailed',
            ),
          );
        });
    },
    [agentId, cancelSourceContinuation, clearPortalStack, forwardTopic, navigate, t, topicId],
  );
};
