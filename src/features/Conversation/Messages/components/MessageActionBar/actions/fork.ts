import { toast } from '@lobehub/ui';
import { GitFork } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import { messageStateSelectors, useConversationStore } from '../../../../store';
import { findLastMessageIdRecursive } from '../../../../store/slices/data/selectors';
import { defineAction } from '../defineAction';

/**
 * Fork the conversation up to this message into a separate new topic.
 *
 * Assistant-only: the fork copies a conversation prefix, so the anchor has to
 * be a reply that already has context behind it. `group` is the aggregated
 * form of the same reply (several assistant blocks rendered as one turn), so it
 * gets the entry too. This is deliberately separate from `branching` — that one
 * opens a thread *inside* the current topic, while this one produces a
 * standalone topic in the sidebar.
 */
export const forkAction = defineAction({
  key: 'fork',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');

    const [topic, forkTopic] = useChatStore((s) => [s.activeTopicId, s.forkTopic]);
    // A thread portal has nowhere standalone to copy into: the copied rows keep
    // their `threadId`, while switching topic clears `activeThreadId`, so the new
    // topic would open with the exchange hidden. The context menu already keeps
    // Fork out of thread and group sessions — the action bar has to agree.
    const inThread = useConversationStore(messageStateSelectors.isThreadMode);
    const isGroupSession = useSessionStore(sessionSelectors.isCurrentSessionGroupSession);
    const isAssistant = ctx.role === 'assistant' || ctx.role === 'group';
    // A `group` context id is the aggregated turn's FIRST row, but the reply the
    // user picked runs on past it (tool results, final text). Anchor the fork on
    // the turn's real tail so the copy carries the whole reply; for a plain
    // assistant message the message itself is already the tail.
    const anchorId =
      ctx.role === 'group' ? (findLastMessageIdRecursive(ctx.data) ?? ctx.id) : ctx.id;

    return useMemo(
      () =>
        isAssistant && !inThread && !isGroupSession
          ? {
              handleClick: async () => {
                if (!topic) {
                  toast.warning(t('forkRequiresSavedTopic'));
                  return;
                }

                await forkTopic(anchorId);
              },
              icon: GitFork,
              key: 'fork',
              label: t('forkTopic'),
            }
          : null,
      [isAssistant, inThread, isGroupSession, t, anchorId, topic, forkTopic],
    );
  },
});
