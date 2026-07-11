import { App } from 'antd';
import isEqual from 'fast-deep-equal';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { useChatStore } from '@/store/chat';
import type { ForwardTarget } from '@/store/chat/slices/forward/action';

import { useConversationStore } from '../store';

export type { ForwardTarget } from '@/store/chat/slices/forward/action';

/**
 * Returns a callback that forwards the currently-selected messages to one or
 * more target agents. The chat store serialises and sends the transcript into
 * one isolated topic per target; this hook owns only selection UX and navigation.
 */
export const useForwardMessages = () => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const navigateToAgent = useNavigateToAgent();
  const forwardMessages = useChatStore((s) => s.forwardMessages);
  const exitSelectionMode = useConversationStore((s) => s.exitSelectionMode);

  // The conversation store is context-scoped (no global getState), so read the
  // selected messages reactively. They're frozen while the picker is open.
  const selectedMessages = useConversationStore((s) => {
    const selected = new Set(s.selectedMessageIds);
    return s.displayMessages.filter((m) => selected.has(m.id));
  }, isEqual);

  return useCallback(
    async (targets: ForwardTarget[], note?: string) => {
      if (selectedMessages.length === 0) {
        message.warning(t('messageForward.empty'));
        return;
      }
      if (targets.length === 0) return;

      const result = await forwardMessages({
        header: t('messageForward.transcript.header', { count: selectedMessages.length }),
        messages: selectedMessages,
        note,
        roleLabel: (role) =>
          role === 'user' ? t('messageForward.role.user') : t('messageForward.role.assistant'),
        targets,
      });

      exitSelectionMode();
      const primary = result.succeeded[0];
      if (primary) navigateToAgent(primary.agentId);

      if (result.succeeded.length > 0) {
        const primaryTarget = targets.find((target) => target.id === primary?.agentId);
        message.success(
          targets.length === 1
            ? t('messageForward.success', { title: primaryTarget?.title || '' })
            : t('messageForward.successMulti', { count: result.succeeded.length }),
        );
      }
      if (result.failed.length > 0) message.error(t('messageForward.failed'));
    },
    [t, message, navigateToAgent, forwardMessages, exitSelectionMode, selectedMessages],
  );
};
