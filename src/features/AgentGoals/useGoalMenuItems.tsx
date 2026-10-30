import { confirmModal, copyToClipboard, type DropdownItem, Icon, toast } from '@lobehub/ui';
import {
  CircleDashedIcon,
  CopyIcon,
  LinkIcon,
  PencilLineIcon,
  TrashIcon,
  Wand2Icon,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGoalTransferMenuItem } from '@/business/client/hooks/useGoalTransferMenuItem';
import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import { renderMenuCheck } from '@/features/AgentTasks/features/menuExtra';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useGoalStore } from '@/store/goal';

import { goalStatusToTaskStatus } from './goalPresentation';
import {
  isStatusChoiceDisabled,
  MANUAL_STATUSES,
  type ManualGoalStatus,
  toManualStatus,
} from './goalStatusMenu';
import { useConfirmDeleteGoal, useGoalRename, useGoalShareUrl } from './useGoalActions';

interface UseGoalMenuItemsOptions {
  /** Absent for a goal with no responsible agent — e.g. one created from a project. */
  agentId?: string;
  creatorUserId?: string | null;
  goalId: string;
  /** Replaces the default redirect to the goal list after a delete. */
  onDeleted?: () => void;
  /** Runs after a status change lands, for hosts that render the status from another read. */
  onStatusChanged?: () => void;
  projectId?: string | null;
  status?: string;
  /** The current title, prefilled by the rename dialog. */
  title?: string;
}

/** The goal's action menu, shared by the detail header's "more" button and the list rows. */
export const useGoalMenuItems = ({
  agentId,
  creatorUserId,
  goalId,
  onDeleted,
  onStatusChanged,
  projectId,
  status,
  title,
}: UseGoalMenuItemsOptions): DropdownItem[] => {
  const { t } = useTranslation(['chat', 'common', 'topic']);
  const { allowed: canEditTask } = usePermission('create_content');
  const shareUrl = useGoalShareUrl({ agentId, goalId });
  const confirmDelete = useConfirmDeleteGoal({ agentId, goalId, onDeleted, projectId });
  // Closing interrupts runs, so the server only lets the creator or a
  // workspace owner do it — the same rule as restart.
  const canClose = useResourceManageable(creatorUserId);
  const pauseGoal = useGoalStore((s) => s.pauseGoal);
  const resumeGoal = useGoalStore((s) => s.resumeGoal);
  const startGoal = useGoalStore((s) => s.startGoal);
  const closeGoal = useGoalStore((s) => s.closeGoal);
  const transferItems = useGoalTransferMenuItem(goalId) as DropdownItem[] | null;
  const { autoRename, openRename } = useGoalRename(goalId);
  // The server lets a workspace goal be renamed only by its creator or an owner.
  const canRename = canEditTask && canClose;

  const current = toManualStatus(status);

  const changeStatus = useCallback(
    (next: ManualGoalStatus) => {
      if (next === current) return;
      const settle = (change: Promise<void>) => void change.then(onStatusChanged);
      if (next === 'running') return settle((status === 'draft' ? startGoal : resumeGoal)(goalId));
      if (next === 'paused') return settle(pauseGoal(goalId));
      // Closing interrupts live runs, so it asks first.
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t(`goalDetail.closeConfirm.${next}.content`),
        okButtonProps: { danger: next === 'canceled' },
        okText: t(`goalDetail.closeConfirm.${next}.ok`),
        onOk: async () => {
          await closeGoal(goalId, next);
          onStatusChanged?.();
        },
        title: t(`goalDetail.closeConfirm.${next}.title`),
      });
    },
    [closeGoal, current, goalId, onStatusChanged, pauseGoal, resumeGoal, startGoal, status, t],
  );

  return useMemo<DropdownItem[]>(
    () => [
      // The topic menu's pair, in the topic menu's order.
      {
        disabled: !canRename,
        icon: <Icon icon={Wand2Icon} />,
        key: 'autoRename',
        label: t('actions.autoRename', { ns: 'topic' }),
        onClick: autoRename,
      },
      {
        disabled: !canRename || title === undefined,
        icon: <Icon icon={PencilLineIcon} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: () => {
          if (title !== undefined) openRename(title);
        },
      },
      { type: 'divider' },
      // Same shape as a task's status submenu: status-colored glyphs, a check on the current one.
      {
        children: MANUAL_STATUSES.map((next) => {
          const visual = TASK_STATUS_VISUALS[goalStatusToTaskStatus(next)];
          return {
            disabled: isStatusChoiceDisabled(next, status, canClose),
            extra: renderMenuCheck(next === current),
            icon: <Icon color={visual.color} icon={visual.icon} />,
            key: `status-${next}`,
            label: t(`goalList.status.${next}`),
            onClick: () => changeStatus(next),
          };
        }),
        disabled: !canEditTask || !status,
        icon: <Icon icon={CircleDashedIcon} />,
        key: 'status',
        label: t('taskList.contextMenu.status'),
      },
      { type: 'divider' },
      {
        icon: <Icon icon={CopyIcon} />,
        key: 'copyId',
        label: t('taskList.contextMenu.copyId'),
        onClick: async () => {
          await copyToClipboard(goalId);
          toast.success(t('taskList.contextMenu.copyIdSuccess'));
        },
      },
      {
        disabled: !shareUrl,
        icon: <Icon icon={LinkIcon} />,
        key: 'copyLink',
        label: t('taskList.contextMenu.copyLink'),
        onClick: async () => {
          if (!shareUrl) return;
          await copyToClipboard(shareUrl);
          toast.success(t('taskList.contextMenu.copyLinkSuccess'));
        },
      },
      ...(transferItems ?? []),
      { type: 'divider' },
      {
        danger: true,
        disabled: !canEditTask,
        icon: <Icon icon={TrashIcon} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: confirmDelete,
      },
    ],
    [
      autoRename,
      canClose,
      canEditTask,
      canRename,
      changeStatus,
      confirmDelete,
      current,
      goalId,
      openRename,
      shareUrl,
      status,
      t,
      title,
      transferItems,
    ],
  );
};

interface UseGoalItemMenuOptions {
  /** The goal's agent, resolved by the host: the route's agent first, then the goal's own. */
  agentId?: string | null;
  /** The cross-agent list rendering the row, refreshed in place of an agent's or project's. */
  globalScopeId?: string;
  goal: {
    agentId?: string | null;
    id: string;
    status: string;
    title?: string;
    userId?: string | null;
  };
  /** The project whose goal page renders the row; absent on an agent's page. */
  projectId?: string;
  /** The route's agent, which keys the list scope on an agent's page. */
  routeAgentId?: string;
}

/** The action menu of a goal-list row (list or card view). */
export const useGoalItemMenu = ({
  agentId,
  globalScopeId,
  goal,
  projectId,
  routeAgentId,
}: UseGoalItemMenuOptions): DropdownItem[] => {
  // The row reads its status from the list, not the goal graph the store
  // actions refresh, so a status change refetches the list it was rendered in.
  const refreshGoals = useGoalStore((s) => s.refreshGoals);
  const scopeId = globalScopeId ?? (projectId ? `project:${projectId}` : routeAgentId);
  const handleStatusChanged = useCallback(() => {
    if (scopeId) void refreshGoals(scopeId);
  }, [refreshGoals, scopeId]);

  return useGoalMenuItems({
    agentId: agentId ?? undefined,
    creatorUserId: goal.userId,
    goalId: goal.id,
    // Deleting from the list keeps the reader on the list it just pruned.
    onDeleted: noop,
    onStatusChanged: handleStatusChanged,
    projectId,
    status: goal.status,
    title: goal.title,
  });
};

const noop = () => {};
