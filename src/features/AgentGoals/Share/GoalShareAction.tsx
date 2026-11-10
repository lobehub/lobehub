import { ActionIcon, Popover, Tooltip } from '@lobehub/ui';
import { Share2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { goalSelectors, useGoalStore } from '@/store/goal';

import GoalSharePopover from './GoalSharePopover';

interface GoalShareActionProps {
  goalId: string;
}

/**
 * The header's Share entry. A share publishes the wrap-up report, so it is
 * offered only to whoever may manage the goal, and stays disabled — with the
 * reason on hover — until the goal has a report to show.
 */
const GoalShareAction = memo<GoalShareActionProps>(({ goalId }) => {
  const { t } = useTranslation('chat');
  const creatorUserId = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.userId);
  const hasReport = useGoalStore((s) => !!goalSelectors.goalGraph(goalId)(s)?.report?.latest);
  const { allowed: canEdit } = usePermission('create_content');
  const canManage = useResourceManageable(creatorUserId);

  if (!canEdit || !canManage) return null;

  if (!hasReport) {
    return (
      <Tooltip title={t('goalDetail.share.disabledNoReport')}>
        {/* A disabled button swallows pointer events, so the tooltip hangs off the wrapper. */}
        <span style={{ display: 'inline-flex' }}>
          <ActionIcon
            disabled
            icon={Share2Icon}
            size={'small'}
            title={t('goalDetail.share.action')}
          />
        </span>
      </Tooltip>
    );
  }

  return (
    <Popover
      arrow={false}
      content={<GoalSharePopover goalId={goalId} />}
      placement={'bottomRight'}
      styles={{ content: { padding: 0, width: 340 } }}
      trigger={['click']}
    >
      <ActionIcon icon={Share2Icon} size={'small'} title={t('goalDetail.share.action')} />
    </Popover>
  );
});

GoalShareAction.displayName = 'GoalShareAction';

export default GoalShareAction;
