import type { TaskAutomationPauseCause } from '@lobechat/types';
import { Alert } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessTaskPauseAction } from '@/business/client/hooks/useBusinessTaskPauseAction';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

interface CauseNoticeProps {
  cause: TaskAutomationPauseCause;
  workspaceId?: string | null;
}

/** A pause the account owner has to clear: names the cause, the remedies, and offers a way out. */
const CauseNotice = memo<CauseNoticeProps>(({ cause, workspaceId }) => {
  const { t } = useTranslation('chat');
  const action = useBusinessTaskPauseAction(cause, workspaceId);

  return (
    <Alert
      showIcon
      action={action}
      description={t(`taskDetail.fusePause.${cause}.desc`)}
      title={t(`taskDetail.fusePause.${cause}.title`)}
      type={'warning'}
    />
  );
});

CauseNotice.displayName = 'TaskFusePauseCauseNotice';

/**
 * Says why a scheduled task stopped when the failure fuse paused it, and what brings it back.
 * Nothing renders for any other pause.
 */
const TaskFusePauseNotice = memo(() => {
  const { t } = useTranslation('chat');
  const fusePause = useTaskStore(taskDetailSelectors.activeTaskFusePause);
  const workspaceId = useTaskStore(taskDetailSelectors.activeTaskWorkspaceId);

  if (!fusePause) return null;
  if (fusePause.cause) return <CauseNotice cause={fusePause.cause} workspaceId={workspaceId} />;

  return (
    <Alert
      showIcon
      description={t('taskDetail.fusePause.desc')}
      title={t('taskDetail.fusePause.title', { count: fusePause.consecutiveFailures })}
      type={'warning'}
    />
  );
});

TaskFusePauseNotice.displayName = 'TaskFusePauseNotice';

export default TaskFusePauseNotice;
