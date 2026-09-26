import { confirmModal } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useGoalStore } from '@/store/goal';

interface GoalRef {
  /** Absent for a goal with no responsible agent — e.g. one created from a project. */
  agentId?: string;
  goalId: string;
}

/**
 * Shareable web URL of a goal. Not `window.location.href`: on desktop that is
 * the `app://renderer` shell origin (and the shell location does not track the
 * active tab) — the URL is built from the app origin and the goal route.
 */
export const useGoalShareUrl = ({ agentId, goalId }: GoalRef): string | undefined => {
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  if (!appOrigin) return;

  const path = agentId ? `/agent/${agentId}/goal/${goalId}` : `/goal/${goalId}`;
  return `${appOrigin}${buildWorkspaceAwarePath(path, activeWorkspaceSlug)}`;
};

interface ConfirmDeleteGoalOptions extends GoalRef {
  /** Replaces the default redirect to the goal list, for hosts that are not the goal page. */
  onDeleted?: () => void;
  projectId?: string | null;
}

/** Opens the delete confirmation for a goal and deletes it on confirm. */
export const useConfirmDeleteGoal = ({
  agentId,
  goalId,
  onDeleted,
  projectId,
}: ConfirmDeleteGoalOptions) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const deleteGoal = useGoalStore((s) => s.deleteGoal);

  return useCallback(() => {
    confirmModal({
      content: t('goalDetail.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('goalDetail.deleteConfirm.ok'),
      onOk: async () => {
        // Mirrors the list scope the goal was rendered under, so the page
        // the user lands on is the one whose cache was just refreshed.
        await deleteGoal(agentId, goalId, projectId ? `project:${projectId}` : undefined);
        if (onDeleted) {
          onDeleted();
          return;
        }
        navigate(
          agentId ? `/agent/${agentId}/goals` : projectId ? `/project/${projectId}/goals` : '/',
        );
      },
      title: t('goalDetail.deleteConfirm.title'),
    });
  }, [agentId, deleteGoal, goalId, navigate, onDeleted, projectId, t]);
};
