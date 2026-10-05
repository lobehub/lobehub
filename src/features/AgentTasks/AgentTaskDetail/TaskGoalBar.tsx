import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { TargetIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

/** "Part of goal" link back to the goal that drives this task, mirroring the parent-task bar. */
const TaskGoalBar = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const goal = useTaskStore(taskDetailSelectors.activeTaskGoal);

  if (!goal) return null;

  return (
    <Flexbox horizontal align="center" gap={8} style={{ maxWidth: '100%', minWidth: 0 }}>
      <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
        {t('taskDetail.partOfGoal')}
      </Text>
      <Button
        icon={<Icon icon={TargetIcon} size={16} />}
        size={'small'}
        style={{ maxWidth: '100%', minWidth: 0 }}
        type={'text'}
        // The agent-less route: the goal's supervising agent may be private to its
        // creator or gated by Agent Lab, while the goal itself stays readable.
        onClick={() => navigate(`/goal/${goal.id}`)}
      >
        <Text ellipsis style={{ minWidth: 0 }} weight={500}>
          {goal.title}
        </Text>
      </Button>
    </Flexbox>
  );
});

export default TaskGoalBar;
