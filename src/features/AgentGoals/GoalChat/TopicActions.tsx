import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

import { type GoalTopicMenuParams, useGoalTopicMenu } from './useGoalTopicMenu';

/** The topic "…" beside the goal chat title. */
const TopicActions = memo<GoalTopicMenuParams>((props) => {
  const items = useGoalTopicMenu(props);

  return (
    <DropdownMenu items={items}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
    </DropdownMenu>
  );
});

TopicActions.displayName = 'GoalChatTopicActions';

export default TopicActions;
