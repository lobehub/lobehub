'use client';

import { MESSAGE_ACTION_BAR_HEIGHT } from '@/const/messageActionPortal';
import { selectionStyles } from '@/features/Conversation/MessageForward/selectionStyles';
import { useDensity } from '@/styles/density';
import { sx } from '@/styles/sx';

import { useKeepActionRowSpace } from '../Contexts/KeepActionRowSpaceContext';

/** The empty room of a hidden action bar, see `KeepActionRowSpaceContext`. */
const ActionRowSpacer = () => {
  const keep = useKeepActionRowSpace();
  const { compact } = useDensity();
  if (!keep || compact) return null;

  return <div aria-hidden {...sx(selectionStyles.hidden, { height: MESSAGE_ACTION_BAR_HEIGHT })} />;
};

export default ActionRowSpacer;
