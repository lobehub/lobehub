'use client';

import { ActionIcon } from '@lobehub/ui';

import { useNavLayout } from '@/hooks/useNavLayout';
import { useHeaderActionSize } from '@/styles/density';

import { resolveHeaderItems } from '../headerItems';

// Home is not a chat surface, so its header carries no "New chat" action: with
// only the workspace identity beside it, the button would not say what it
// creates. Starting a conversation lives where the context is — the Home
// composer, and the agent sidebar's "Start New Topic" once an agent is open.
const HeaderActions = () => {
  const headerActionSize = useHeaderActionSize(true);
  const { topNavItems } = useNavLayout();
  const { search } = resolveHeaderItems(topNavItems);

  if (!search) return null;

  return (
    <ActionIcon
      aria-label={search.title}
      icon={search.icon}
      size={headerActionSize}
      title={search.title}
      onClick={search.onClick}
    />
  );
};

export default HeaderActions;
