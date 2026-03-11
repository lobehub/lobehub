import { type ActionIconGroupEvent } from '@lobehub/ui';
import { ActionIconGroup } from '@lobehub/ui';
import { memo } from 'react';

import { type AssistantActions } from './useAssistantActions';

interface ErrorActionsBarProps {
  actions: AssistantActions;
  onActionClick: (event: ActionIconGroupEvent) => void;
}

export const ErrorActionsBar = memo<ErrorActionsBarProps>(({ actions, onActionClick }) => {
  const { regenerate, copy, edit, del, divider } = actions;

  return (
    <ActionIconGroup
      items={[regenerate, del]}
      menu={[edit, copy, divider, del]}
      onActionClick={onActionClick}
    />
  );
});

ErrorActionsBar.displayName = 'ErrorActionsBar';
