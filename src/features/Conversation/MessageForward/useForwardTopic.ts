import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import type { ForwardTarget } from '@/store/chat/slices/forward/action';

interface ForwardTopicSource {
  agentId: string;
  topicId: string;
}

export const useForwardTopic = ({ agentId, topicId }: ForwardTopicSource) => {
  const { t } = useTranslation('chat');

  const navigate = useWorkspaceAwareNavigate();
  const forwardTopic = useChatStore((s) => s.forwardTopic);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  return useCallback(
    (targets: ForwardTarget[], note?: string) => {
      if (targets.length === 0) return;

      const primaryTarget = targets[0];
      void forwardTopic({
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
          if (result.failed.length > 0) toast.error(t('messageForward.failed'));
        })
        .catch(() => toast.error(t('messageForward.topic.loadFailed')));
    },
    [agentId, clearPortalStack, forwardTopic, navigate, t, topicId],
  );
};
