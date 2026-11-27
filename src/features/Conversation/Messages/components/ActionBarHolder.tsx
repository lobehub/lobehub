'use client';

import { MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES } from '@/const/messageActionPortal';
import { selectionStyles } from '@/features/Conversation/MessageForward/selectionStyles';
import { useDensity } from '@/styles/density';
import { sx } from '@/styles/sx';

interface ActionBarHolderProps {
  type: keyof typeof MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES;
}

const ActionBarHolder = ({ type }: ActionBarHolderProps) => {
  const { compact } = useDensity();

  return (
    <div
      {...{ [MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES[type]]: '' }}
      {...sx(selectionStyles.hidden, { height: compact ? undefined : '28px' })}
    />
  );
};

export default ActionBarHolder;
