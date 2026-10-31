'use client';

import type { FollowUpChip } from '@lobechat/types';
import * as stylex from '@stylexjs/stylex';
import { Reply } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';

import { messageStateSelectors, useConversationStore } from '@/features/Conversation/store';
import { followUpActionSelectors, useFollowUpActionStore } from '@/store/followUpAction';
import { sx } from '@/styles/sx';

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
  const fillInputMessage = useConversationStore((s) => s.fillInputMessage);
  const recordChipClick = useFollowUpActionStore((s) => s.recordChipClick);
  const isGenerating = useConversationStore(
    messageStateSelectors.isAssistantGroupItemGenerating(messageId),
  );

  const handleClick = useCallback(
    (chip: FollowUpChip, chipIndex: number) => {
      recordChipClick(conversationKey, chipIndex);
      fillInputMessage(chip.message);
    },
    [recordChipClick, conversationKey, fillInputMessage],
  );

  if (chips.length === 0 || isGenerating) return null;

  return (
    <div {...stylex.props(styles.root)}>
      {chips.map((chip, i) => (
        <button
          aria-label={chip.label}
          key={`${messageId}-${i}`}
          {...sx([styles.chip, stylex.defaultMarker()], undefined, {
            animationDelay: `${i * 60}ms`,
          })}
          type="button"
          onClick={() => handleClick(chip, i)}
        >
          <Reply {...stylex.props(styles.chipIcon)} size={14} />
          <span>{chip.label}</span>
        </button>
      ))}
    </div>
  );
});

FollowUpChips.displayName = 'FollowUpChips';

export default FollowUpChips;
