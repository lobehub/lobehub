'use client';

import { selectionStyles } from '@/features/Conversation/MessageForward/selectionStyles';
import { sx } from '@/styles/sx';

import { useKeepActionRowSpace } from '../Contexts/KeepActionRowSpaceContext';

/** The empty room of a hidden action bar, see `KeepActionRowSpaceContext`. */
const ActionRowSpacer = () => {
  const keep = useKeepActionRowSpace();
  if (!keep) return null;

  return <div aria-hidden {...sx(selectionStyles.hidden, { height: '28px' })} />;
};

export default ActionRowSpacer;
