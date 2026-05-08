'use client';

import type { FollowUpChip } from '@lobechat/types';
import { Reply } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';

import { useConversationStore } from '@/features/Conversation';
import { followUpActionSelectors, useFollowUpActionStore } from '@/store/followUpAction';

import { messageStateSelectors } from '../store';
import { styles } from './style';

interface FollowUpChipsProps {
  messageId: string;
  topicId: string;
}

const FollowUpChips = memo<FollowUpChipsProps>(({ messageId, topicId }) => {
  // For assistantGroup, the server resolves the latest answer message id which
  // lives inside `children`, not as the top-level group id. Collect children ids
  // as a stable primitive so the followUpAction selector can match either.
  const childIdsKey = useConversationStore((s) => {
    const m = s.displayMessages.find((x) => x.id === messageId);
    return m?.children?.map((c) => c.id).join('|') ?? '';
  });
  const selector = useMemo(
    () => followUpActionSelectors.chipsFor({ childIdsKey, messageId, topicId }),
    [childIdsKey, messageId, topicId],
  );
  const chips = useFollowUpActionStore(selector);
  const consume = useFollowUpActionStore((s) => s.consume);
  const updateInputMessage = useConversationStore((s) => s.updateInputMessage);
  const editor = useConversationStore((s) => s.editor);
  // Hide chips while the bound group/message is still being generated — chips
  // are only valid for a fully settled assistant turn.
  const isGenerating = useConversationStore(
    messageStateSelectors.isAssistantGroupItemGenerating(messageId),
  );

  const handleClick = useCallback(
    (chip: FollowUpChip) => {
      consume(chip);
      updateInputMessage(chip.message);
      editor?.setDocument('text', chip.message);
      editor?.focus();
    },
    [consume, updateInputMessage, editor],
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
