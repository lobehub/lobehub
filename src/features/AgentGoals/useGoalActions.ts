import { GOAL_TITLE_MAX_LENGTH } from '@lobechat/const/goal';
import { confirmModal, toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { openRenameModal } from '@/components/RenameModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useGoalStore } from '@/store/goal';
import { isForbiddenError } from '@/utils/forbiddenError';

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
          agentId
            ? `/agent/${agentId}/goals`
            : projectId
              ? `/project/${projectId}/goals`
              : '/goals',
        );
      },
      title: t('goalDetail.deleteConfirm.title'),
    });
  }, [agentId, deleteGoal, goalId, navigate, onDeleted, projectId, t]);
};

/**
 * Rename a goal by hand or let the topic naming model do it — the same two
 * actions, copy and error handling as a topic's menu. Each settles on its own
 * and reports a failure itself, so a caller only wires up the click.
 */
export const useGoalRename = (goalId: string) => {
  const { t } = useTranslation(['topic', 'common']);
  const updateGoalTitle = useGoalStore((s) => s.updateGoalTitle);
  const autoRenameGoalTitle = useGoalStore((s) => s.autoRenameGoalTitle);

  const reportFailure = useCallback(
    (error: unknown) => {
      toast.error(
        isForbiddenError(error)
          ? t('manageOnlyCreator', { ns: 'common' })
          : t('operationFailed', { ns: 'common' }),
      );
    },
    [t],
  );

  /** Saves `title`; rejects after reporting, so an editor can keep the typed text. */
  const rename = useCallback(
    async (title: string) => {
      try {
        await updateGoalTitle(goalId, title);
      } catch (error) {
        console.error('[useGoalRename] rename failed:', error);
        reportFailure(error);
        throw error;
      }
    },
    [goalId, reportFailure, updateGoalTitle],
  );

  const openRename = useCallback(
    (title: string) =>
      openRenameModal({
        defaultValue: title,
        maxLength: GOAL_TITLE_MAX_LENGTH,
        onSave: rename,
      }),
    [rename],
  );

  const autoRename = useCallback(async () => {
    try {
      await autoRenameGoalTitle(goalId);
    } catch (error) {
      console.error('[useGoalRename] auto rename failed:', error);
      reportFailure(error);
    }
  }, [autoRenameGoalTitle, goalId, reportFailure]);

  return { autoRename, openRename, rename };
};
