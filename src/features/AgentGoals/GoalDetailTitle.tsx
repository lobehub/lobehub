import { GOAL_TITLE_MAX_LENGTH } from '@lobechat/const/goal';
import { TextArea } from '@lobehub/ui';
import { memo } from 'react';

import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { shinyTextStyles } from '@/styles';

import { useGoalRename } from './useGoalActions';
import { useGoalTitleEditor } from './useGoalTitleEditor';

/** Past this many lines the header scrolls the title instead of pushing the page down. */
const MAX_TITLE_ROWS = 3;

interface GoalDetailTitleProps {
  creatorUserId?: string | null;
  goalId: string;
  title: string;
}

/**
 * The goal page's title, edited in place (see `useGoalTitleEditor`). Wraps
 * instead of truncating, up to `MAX_TITLE_ROWS`, so a goal still titled with a
 * whole pasted prompt cannot take over the page before it is renamed.
 */
const GoalDetailTitle = memo<GoalDetailTitleProps>(({ creatorUserId, goalId, title }) => {
  const { allowed: canEdit } = usePermission('create_content');
  // Same rule the server applies to a workspace goal: its creator or an owner.
  const canManage = useResourceManageable(creatorUserId);
  const renaming = useGoalStore(goalSelectors.isGoalTitleRenaming(goalId));
  const { rename } = useGoalRename(goalId);
  const { onBlur, onKeyDown, setValue, value } = useGoalTitleEditor(title, rename);

  return (
    <TextArea
      autoSize={{ maxRows: MAX_TITLE_ROWS, minRows: 1 }}
      className={renaming ? shinyTextStyles.shinyText : undefined}
      maxLength={GOAL_TITLE_MAX_LENGTH}
      readOnly={!canEdit || !canManage || renaming}
      style={{ padding: 0 }}
      value={value}
      variant={'borderless'}
      styles={{
        input: { fontSize: 22, fontWeight: 600, lineHeight: 1.35, minHeight: 'auto' },
      }}
      onBlur={onBlur}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
    />
  );
});

GoalDetailTitle.displayName = 'GoalDetailTitle';

export default GoalDetailTitle;
