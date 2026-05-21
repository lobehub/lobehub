'use client';

import type { FollowUpChip } from '@lobechat/types';
import { Reply } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';

import { useConversationStore } from '@/features/Conversation';
import { followUpActionSelectors, useFollowUpActionStore } from '@/store/followUpAction';

import { messageStateSelectors } from '../store';
import { styles } from './style';

interface FollowUpChipsProps {
  conversationKey: string;
  messageId: string;
}

const FollowUpChips = memo<FollowUpChipsProps>(({ conversationKey, messageId }) => {
  const childIdsKey = useConversationStore((s) => {
    const m = s.displayMessages.find((x) => x.id === messageId);
    return m?.children?.map((c) => c.id).join('|') ?? '';
  });
  const selector = useMemo(
    () => followUpActionSelectors.chipsFor({ childIdsKey, conversationKey, messageId }),
    [childIdsKey, conversationKey, messageId],
  );
  const chips = useFollowUpActionStore(selector);
  const updateInputMessage = useConversationStore((s) => s.updateInputMessage);
  const editor = useConversationStore((s) => s.editor);
  const isGenerating = useConversationStore(
    messageStateSelectors.isAssistantGroupItemGenerating(messageId),
  );

  const handleClick = useCallback(
    (chip: FollowUpChip) => {
      updateInputMessage('');
      editor?.setDocument('text', '');
      updateInputMessage(chip.message);
      editor?.setDocument('text', chip.message);
      editor?.focus();
    },
    [updateInputMessage, editor],
  );

  if (chips.length === 0 || isGenerating) return null;

  return (
    <div className={styles.root}>
      {chips.map((chip, i) => (
        <button
          aria-label={chip.label}
          className={styles.chip}
          key={`${messageId}-${i}`}
          style={{ animationDelay: `${i * 60}ms` }}
          type="button"
          onClick={() => handleClick(chip)}
        >
          <Reply className={`${styles.chipIcon} followup-icon`} size={14} />
          <span>{chip.label}</span>
        </button>
      ))}
    </div>
  );
});

FollowUpChips.displayName = 'FollowUpChips';

export default FollowUpChips;
