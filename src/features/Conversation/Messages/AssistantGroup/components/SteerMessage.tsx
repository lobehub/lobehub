import { type InterfaceDensity } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useInterfaceDensity } from '@/styles/density';

import { dataSelectors, useConversationStore } from '../../../store';
import UserMessage from '../../User';

/**
 * Extra space around a steer bubble so it sits as far from the surrounding
 * turn output as a standalone user row does. A standalone row is separated
 * from the previous reply by that reply's action row (8px gap + 28px bar) and
 * both rows' block padding; inside the chain only the 4px chain gap exists.
 * Compact floats the action bar instead of reserving its row, so less is needed.
 */
const STANDALONE_ROW_SPACING = {
  compact: 20,
  loose: 40,
} as const satisfies Record<InterfaceDensity, number>;

interface SteerMessageProps {
  id: string;
}

/**
 * A queued follow-up rendered inside the turn it steered. It is the same user
 * row as a standalone message — avatar, title, bubble and the steer arrow
 * (driven by `metadata.steer`) — with editing disabled: hovering it must not
 * claim the message action bar from the assistant turn that hosts it.
 */
const SteerMessage = memo<SteerMessageProps>(({ id }) => {
  const exists = useConversationStore((s) => !!dataSelectors.getDisplayMessageById(id)(s));
  const density = useInterfaceDensity();

  if (!exists) return null;

  return (
    <Flexbox data-steer-message={id} paddingBlock={STANDALONE_ROW_SPACING[density]}>
      <UserMessage disableEditing id={id} index={0} />
    </Flexbox>
  );
});

SteerMessage.displayName = 'SteerMessage';

export default SteerMessage;
