import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import type { ForwardResult, ForwardTarget } from '@/store/chat/slices/forward/action';

interface ForwardTopicSource {
  agentId: string;
  cancelSourceContinuation?: boolean;
  topicId: string;
}

const getHandoffFailureKey = (result: ForwardResult) => {
  // No target confirmed and the source run is paused: inspect before re-arming.
  if (result.sourceSchedulePaused) return 'messageForward.topic.handoff.sourceSchedulePaused';
  // A target topic exists although its send failed; a retry would hand off twice.
  if (result.failed.some((item) => item.topicId)) return 'messageForward.topic.handoff.unconfirmed';
  // "Some Agents" only fits when at least one target took the handoff.
  return result.succeeded.length > 0
    ? 'messageForward.topic.handoff.partialFailed'
    : 'messageForward.topic.handoff.failed';
};

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
        header: t(
          cancelSourceContinuation
            ? 'messageForward.topic.handoff.header'
            : 'messageForward.topic.header',
        ),
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
                ? t(
                    cancelSourceContinuation
                      ? 'messageForward.topic.handoff.success'
                      : 'messageForward.success',
                    { title: primaryTarget.title || '' },
                  )
                : t(
                    cancelSourceContinuation
                      ? 'messageForward.topic.handoff.successMulti'
                      : 'messageForward.successMulti',
                    { count: result.succeeded.length },
                  ),
            );
          }
          if (result.failed.length > 0)
            toast.error(
              t(cancelSourceContinuation ? getHandoffFailureKey(result) : 'messageForward.failed'),
            );
        })
        .catch((error) => {
          console.error('[useForwardTopic] Forwarding failed:', error);
          toast.error(
            t(
              cancelSourceContinuation
                ? 'messageForward.topic.handoff.notStarted'
                : 'messageForward.topic.loadFailed',
            ),
          );
        });
    },
    [agentId, cancelSourceContinuation, clearPortalStack, forwardTopic, navigate, t, topicId],
  );
};
