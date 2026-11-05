'use client';

import { agentDisplayName, isTaskArchiveBlocked } from '@lobechat/types';
import {
  confirmModal,
  copyToClipboard,
  cssVar,
  Icon,
  stopPropagation,
  Tag,
  toast,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Command } from 'cmdk';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeft,
  BarChart3Icon,
  BotIcon,
  CircleDashedIcon,
  CopyIcon,
  Trash2Icon,
  UserRoundCheckIcon,
  UserRoundXIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AgentAvatar from '@/components/AgentAvatar';
import { styles } from '@/features/CommandMenu/styles';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import type { TaskListItem } from '@/store/task/slices/list/initialState';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { PRIORITY_META } from '../../features/TaskPriorityTag';
import { STATUS_META } from '../../features/taskStatusMeta';
import { hasWorkspaceMemberDirectory } from '../../shared/memberAssigneeMode';
import BulkDeleteConfirmContent from './BulkDeleteConfirmContent';
import { useTaskSelectionStore } from './store';
import { countTasksCreatedByOthers } from './taskSelectionModel';
import { type TaskBatchStatus, useTaskBatchActions } from './useTaskBatchActions';

const BATCH_STATUSES: TaskBatchStatus[] = ['backlog', 'paused', 'completed', 'canceled'];
const PRIORITY_LEVELS = [0, 1, 2, 3, 4];

type Page = 'agent' | 'priority' | 'status';

interface TaskBulkActionsPanelProps {
  onClose: () => void;
  tasks: TaskListItem[];
}

const Item = ({
  danger,
  disabled,
  icon,
  label,
  onSelect,
  value,
}: {
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  value: string;
}) => (
  <Command.Item
    {...stylex.props(styles.cmdkItem)}
    disabled={disabled}
    value={value}
    onSelect={onSelect}
  >
    {icon}
    <div className={stylex.props(styles.itemContent).className}>
      <div
        className={stylex.props(styles.itemLabel).className}
        style={danger ? { color: cssVar.colorError } : undefined}
      >
        {label}
      </div>
    </div>
  </Command.Item>
);

/**
 * cmdk panel of the actions that apply to every selected task. Each action is
 * one batch request for the whole selection (see `useTaskBatchActions`).
 */
const TaskBulkActionsPanel = memo<TaskBulkActionsPanelProps>(({ onClose, tasks }) => {
  const { t } = useTranslation('chat');
  const selectedIds = useTaskSelectionStore((s) => s.selectedIds);
  const { run, running } = useTaskBatchActions();
  const { allowed: canEdit } = usePermission('create_content');
  const activeWorkspaceId = useActiveWorkspaceId();
  const userId = useUserStore(userProfileSelectors.userId);
  const [page, setPage] = useState<Page>();
  const [search, setSearch] = useState('');

  useFetchAgentList();
  const allAgents = useHomeStore(homeAgentListSelectors.allAgents);
  const agents = useMemo(() => {
    const seen = new Set<string>();
    return allAgents.filter((item) => {
      if (item.type !== 'agent' || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [allAgents]);

  const selectedTasks = useMemo(() => {
    const ids = new Set(selectedIds);
    return tasks.filter((task) => ids.has(task.id));
  }, [selectedIds, tasks]);
  const allArchived = selectedTasks.length > 0 && selectedTasks.every((task) => task.archivedAt);
  const anyArchivable = selectedTasks.some(
    (task) => !task.archivedAt && !isTaskArchiveBlocked(task),
  );

  const disabled = !canEdit || running;
  const goTo = (next?: Page) => {
    setPage(next);
    setSearch('');
  };
  const act = (action: Parameters<typeof run>[0]) => {
    onClose();
    void run(action);
  };

  const confirmDelete = () => {
    onClose();
    // Any member who can edit tasks may delete a teammate's task, as with a
    // single task; in a batch it is easy to miss, so say how many are theirs.
    const othersCount = activeWorkspaceId ? countTasksCreatedByOthers(selectedTasks, userId) : 0;
    confirmModal({
      content: <BulkDeleteConfirmContent count={selectedIds.length} othersCount={othersCount} />,
      okButtonProps: { danger: true },
      okText: t('taskList.bulk.deleteConfirm.ok'),
      onOk: () => run({ kind: 'delete' }),
      title: t('taskList.bulk.deleteConfirm.title', { count: selectedIds.length }),
    });
  };

  const copyIds = async () => {
    const identifiers = selectedTasks.map((task) => task.identifier).join('\n');
    await copyToClipboard(identifiers);
    toast.success(t('taskList.bulk.copied', { count: selectedTasks.length }));
    onClose();
  };

  const statusLabel = (status: TaskBatchStatus) =>
    t(`taskDetail.status.${status}` as never, { defaultValue: STATUS_META[status].label });
  const priorityLabel = (level: number) =>
    t(`taskDetail.${PRIORITY_META[level].labelKey}` as never, {
      defaultValue: PRIORITY_META[level].label,
    });

  const placeholder = page
    ? t(`taskList.bulk.search.${page}`)
    : t('taskList.bulk.search.placeholder');

  const panel = (
    <div className={stylex.props(styles.overlay).className} onClick={onClose}>
      <div onClick={stopPropagation}>
        <Command
          className={stylex.props(styles.commandRoot).className}
          data-testid={'task-bulk-actions-panel'}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              if (page) goTo(undefined);
              else onClose();
            }
            if (event.key === 'Backspace' && !search && page) {
              event.preventDefault();
              goTo(undefined);
            }
          }}
        >
          <div className={stylex.props(styles.contextWrapper).className}>
            {page && (
              <Tag
                className={stylex.props(styles.backTag).className}
                icon={<ArrowLeft size={12} />}
                onClick={() => goTo()}
              />
            )}
            <Tag className={stylex.props(styles.contextTag).className}>
              {t('taskList.bulk.count', { count: selectedIds.length })}
            </Tag>
          </div>
          <div className={stylex.props(styles.inputWrapper).className}>
            <Command.Input
              {...stylex.props(styles.cmdkInput)}
              autoFocus
              placeholder={placeholder}
              value={search}
              onValueChange={setSearch}
            />
          </div>
          <Command.List {...stylex.props(styles.cmdkList)}>
            <Command.Empty {...stylex.props(styles.cmdkEmpty)}>
              {t('taskList.bulk.noResults')}
            </Command.Empty>

            {!page && (
              <Command.Group>
                <Item
                  disabled={disabled}
                  label={t('taskList.bulk.changeStatus')}
                  value={'change status'}
                  icon={
                    <Icon className={stylex.props(styles.icon).className} icon={CircleDashedIcon} />
                  }
                  onSelect={() => goTo('status')}
                />
                <Item
                  disabled={disabled}
                  label={t('taskList.bulk.setPriority')}
                  value={'set priority'}
                  icon={
                    <Icon className={stylex.props(styles.icon).className} icon={BarChart3Icon} />
                  }
                  onSelect={() => goTo('priority')}
                />
                <Item
                  disabled={disabled}
                  icon={<Icon className={stylex.props(styles.icon).className} icon={BotIcon} />}
                  label={t('taskList.bulk.assignAgent')}
                  value={'assign agent'}
                  onSelect={() => goTo('agent')}
                />
                {hasWorkspaceMemberDirectory(activeWorkspaceId) && userId && (
                  <>
                    <Item
                      disabled={disabled}
                      label={t('taskList.bulk.assignToMe')}
                      value={'assign to me'}
                      icon={
                        <Icon
                          className={stylex.props(styles.icon).className}
                          icon={UserRoundCheckIcon}
                        />
                      }
                      onSelect={() => act({ kind: 'update', patch: { assigneeUserId: userId } })}
                    />
                    <Item
                      disabled={disabled}
                      label={t('taskList.bulk.unassignMember')}
                      value={'unassign member'}
                      icon={
                        <Icon
                          className={stylex.props(styles.icon).className}
                          icon={UserRoundXIcon}
                        />
                      }
                      onSelect={() => act({ kind: 'update', patch: { assigneeUserId: null } })}
                    />
                  </>
                )}
                {allArchived ? (
                  <Item
                    disabled={disabled}
                    label={t('taskList.bulk.unarchive')}
                    value={'unarchive restore'}
                    icon={
                      <Icon
                        className={stylex.props(styles.icon).className}
                        icon={ArchiveRestoreIcon}
                      />
                    }
                    onSelect={() => act({ archived: false, kind: 'archive' })}
                  />
                ) : (
                  <Item
                    disabled={disabled || !anyArchivable}
                    label={t('taskList.bulk.archive')}
                    value={'archive'}
                    icon={
                      <Icon className={stylex.props(styles.icon).className} icon={ArchiveIcon} />
                    }
                    onSelect={() => act({ archived: true, kind: 'archive' })}
                  />
                )}
                <Item
                  icon={<Icon className={stylex.props(styles.icon).className} icon={CopyIcon} />}
                  label={t('taskList.bulk.copyIds')}
                  value={'copy ids identifiers'}
                  onSelect={copyIds}
                />
                <Item
                  danger
                  disabled={disabled}
                  label={t('taskList.bulk.delete')}
                  value={'delete remove'}
                  icon={
                    <Icon
                      className={stylex.props(styles.icon).className}
                      color={cssVar.colorError}
                      icon={Trash2Icon}
                    />
                  }
                  onSelect={confirmDelete}
                />
              </Command.Group>
            )}

            {page === 'status' && (
              <Command.Group>
                {BATCH_STATUSES.map((status) => {
                  const meta = STATUS_META[status];
                  return (
                    <Item
                      disabled={disabled}
                      key={status}
                      label={statusLabel(status)}
                      value={`status ${status} ${statusLabel(status)}`}
                      icon={
                        <Icon
                          className={stylex.props(styles.icon).className}
                          color={meta.color}
                          icon={meta.icon}
                        />
                      }
                      onSelect={() => act({ kind: 'status', status })}
                    />
                  );
                })}
              </Command.Group>
            )}

            {page === 'priority' && (
              <Command.Group>
                {PRIORITY_LEVELS.map((level) => {
                  const PriorityIcon = PRIORITY_META[level].icon;
                  return (
                    <Item
                      disabled={disabled}
                      key={level}
                      label={priorityLabel(level)}
                      value={`priority ${level} ${priorityLabel(level)}`}
                      icon={
                        <PriorityIcon
                          color={level === 1 ? cssVar.orange : cssVar.colorTextSecondary}
                          size={16}
                        />
                      }
                      onSelect={() => act({ kind: 'update', patch: { priority: level } })}
                    />
                  );
                })}
              </Command.Group>
            )}

            {page === 'agent' && (
              <Command.Group>
                <Item
                  disabled={disabled}
                  label={t('taskList.bulk.unassignAgent')}
                  value={'unassigned none'}
                  icon={
                    <Icon className={stylex.props(styles.icon).className} icon={UserRoundXIcon} />
                  }
                  onSelect={() => act({ kind: 'update', patch: { assigneeAgentId: null } })}
                />
                {agents.map((agent) => {
                  const name = agentDisplayName(agent) ?? agent.id;
                  return (
                    <Item
                      disabled={disabled}
                      key={agent.id}
                      label={name}
                      value={`agent ${agent.id} ${name}`}
                      icon={
                        <AgentAvatar
                          agentId={agent.id}
                          avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
                          name={name}
                          shape={'square'}
                          size={20}
                        />
                      }
                      onSelect={() => act({ kind: 'update', patch: { assigneeAgentId: agent.id } })}
                    />
                  );
                })}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
});

TaskBulkActionsPanel.displayName = 'TaskBulkActionsPanel';

export default TaskBulkActionsPanel;
