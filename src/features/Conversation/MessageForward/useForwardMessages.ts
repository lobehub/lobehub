import { nanoid } from '@lobechat/utils';
import { App } from 'antd';
import isEqual from 'fast-deep-equal';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { useChatStore } from '@/store/chat';

import { useConversationStore } from '../store';
import { buildForwardedContent } from './forwardDispatch';
import { useForwardDispatchStore } from './forwardDispatchStore';

export interface ForwardTarget {
  id: string;
  title?: string | null;
}

/**
 * Returns a callback that forwards the currently-selected messages to one or
 * more target agents. The transcript is serialised once, then:
 * - the first (primary) target is parked + navigated to, so the user lands in
 *   it and {@link ForwardMessageDispatcher} sends the opening turn;
 * - any additional targets are sent in the background via the global chat store
 *   (isolated new topic each), so "send separately" reaches every recipient.
 */
export const useForwardMessages = () => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const navigateToAgent = useNavigateToAgent();
  const setPendingForward = useForwardDispatchStore((s) => s.setPendingForward);
  const exitSelectionMode = useConversationStore((s) => s.exitSelectionMode);

  // The conversation store is context-scoped (no global getState), so read the
  // selected messages reactively. They're frozen while the picker is open.
  const selectedMessages = useConversationStore((s) => {
    const selected = new Set(s.selectedMessageIds);
    return s.displayMessages.filter((m) => selected.has(m.id));
  }, isEqual);

  return useCallback(
    (targets: ForwardTarget[], note?: string) => {
      if (selectedMessages.length === 0) {
        message.warning(t('messageForward.empty'));
        return;
      }
      if (targets.length === 0) return;

      const transcript = buildForwardedContent(selectedMessages, {
        header: t('messageForward.transcript.header', { count: selectedMessages.length }),
        roleLabel: (role) =>
          role === 'user' ? t('messageForward.role.user') : t('messageForward.role.assistant'),
      });
      // Append the user's optional note as the actual instruction after the
      // forwarded context.
      const content = note?.trim() ? `${transcript}\n\n${note.trim()}` : transcript;

      const [primary, ...rest] = targets;

      // Primary: park the transcript so the post-navigation dispatcher sends it.
      setPendingForward({
        content,
        dispatchId: nanoid(),
        messageCount: selectedMessages.length,
        targetAgentId: primary.id,
      });

      // Additional recipients: fire-and-forget background sends into an isolated
      // new topic each (no navigation, no hijacking the active topic).
      for (const target of rest) {
        void useChatStore
          .getState()
          .sendMessage({
            context: { agentId: target.id, isNew: true, isolatedTopic: true, scope: 'main' },
            message: content,
            messages: [],
          })
          .catch(() => {});
      }

      exitSelectionMode();
      navigateToAgent(primary.id);

      message.success(
        targets.length === 1
          ? t('messageForward.success', { title: primary.title || '' })
          : t('messageForward.successMulti', { count: targets.length }),
      );
    },
    [t, message, navigateToAgent, setPendingForward, exitSelectionMode, selectedMessages],
  );
};
