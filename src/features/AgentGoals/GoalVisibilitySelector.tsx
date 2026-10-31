import { toast } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import TaskVisibilityChipLabel from '@/features/AgentTasks/features/TaskVisibilityChipLabel';
import TaskVisibilityTag from '@/features/AgentTasks/features/TaskVisibilityTag';
import { useAgentVisibility } from '@/features/AgentTasks/shared/useAgentVisibility';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { goalVisibilityLockKey } from './goalVisibilityLock';

interface GoalVisibilitySelectorProps {
  goalId: string;
}

/**
 * Who in the Workspace sees the goal, as the same Private / Workspace chip a
 * Task carries. Only the creator may switch it (the server's rule), and a goal
 * run by a private agent cannot go public. Hidden outside a Workspace.
 */
const GoalVisibilitySelector = memo<GoalVisibilitySelectorProps>(({ goalId }) => {
  const { t } = useTranslation('chat');
  const [saving, setSaving] = useState(false);
  const graph = goalSelectors.goalGraph(goalId);
  const workspaceId = useGoalStore((s) => graph(s)?.goal.workspaceId);
  const ownerId = useGoalStore((s) => graph(s)?.goal.userId);
  // Rows read before the column shipped carry no value: they are public.
  const visibility = useGoalStore((s) => graph(s)?.goal.visibility) ?? 'public';
  const agentId = useGoalStore((s) => graph(s)?.goal.agentId);
  const taskAgentId = useGoalStore((s) => graph(s)?.goal.config?.taskAgentId);
  const setGoalVisibility = useGoalStore((s) => s.setGoalVisibility);
  const viewerId = useUserStore(userProfileSelectors.userId);
  const agentPrivate = useAgentVisibility(agentId) === 'private';
  const taskAgentPrivate = useAgentVisibility(taskAgentId) === 'private';

  if (!workspaceId) return null;

  const lockKey = goalVisibilityLockKey({
    agentPrivate: agentPrivate || taskAgentPrivate,
    ownerId,
    viewerId,
    visibility,
  });
  const lockedReason = lockKey ? t(lockKey) : undefined;

  const change = async (next: 'private' | 'public') => {
    if (saving) return;
    setSaving(true);
    try {
      await setGoalVisibility(goalId, next);
    } catch (error) {
      toast.error((error as Error).message || t('goalDetail.visibility.changeFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <TaskVisibilityTag lockedReason={lockedReason} visibility={visibility} onChange={change}>
      <TaskVisibilityChipLabel style={{ minHeight: 32 }} visibility={visibility} />
    </TaskVisibilityTag>
  );
});

GoalVisibilitySelector.displayName = 'GoalVisibilitySelector';

export default GoalVisibilitySelector;
