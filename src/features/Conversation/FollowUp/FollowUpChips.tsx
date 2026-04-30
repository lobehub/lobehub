'use client';

import type { FollowUpChip } from '@lobechat/types';
import { Reply } from 'lucide-react';
import { memo, useCallback } from 'react';

import { useConversationStore } from '@/features/Conversation';
import { followUpActionSelectors, useFollowUpActionStore } from '@/store/followUpAction';

import { styles } from './style';

interface FollowUpChipsProps {
  messageId: string;
}

const FollowUpChips = memo<FollowUpChipsProps>(({ messageId }) => {
  const chips = useFollowUpActionStore(followUpActionSelectors.chipsForMessage(messageId));
  const consume = useFollowUpActionStore((s) => s.consume);
  const sendMessage = useConversationStore((s) => s.sendMessage);

  const handleClick = useCallback(
    (chip: FollowUpChip) => {
      consume(chip);
      void sendMessage({ message: chip.message });
    },
    [consume, sendMessage],
  );

  if (chips.length === 0) return null;

  return (
    <div className={styles.root}>
      {chips.map((chip, i) => (
        <button
          aria-label={chip.label}
          className={styles.chip}
          key={`${messageId}-${i}`}
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
