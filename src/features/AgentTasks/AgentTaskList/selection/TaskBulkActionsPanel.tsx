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
import { type SidebarAgentItem } from '@/database/repositories/home';
import { styles } from '@/features/CommandMenu/styles';
import { usePermission } from '@/hooks/usePermission';
import type { TaskListItem } from '@/store/task/slices/list/initialState';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { pickRecentAssignees } from '../../features/assigneeAgentSections';
import { PRIORITY_META } from '../../features/TaskPriorityTag';
import { STATUS_META } from '../../features/taskStatusMeta';
import { useAssigneeAgentScopes } from '../../features/useAssigneeAgentScopes';
import { hasWorkspaceMemberDirectory } from '../../shared/memberAssigneeMode';
import BulkAssignPrivateConfirmContent from './BulkAssignPrivateConfirmContent';
import BulkDeleteConfirmContent from './BulkDeleteConfirmContent';
import { privatizeTasks } from './privatizeTasks';
import { useTaskSelectionStore } from './store';
import { countTasksCreatedByOthers, pickTasksToPrivatize } from './taskSelectionModel';
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
  <Command.Item disabled={disabled} value={value} onSelect={onSelect}>
    {icon}
    <div className={styles.itemContent}>
      <div className={styles.itemLabel} style={danger ? { color: cssVar.colorError } : undefined}>
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
  const { t } = useTranslation(['chat', 'common', 'topic']);
  const selectedIds = useTaskSelectionStore((s) => s.selectedIds);
  const { run, running } = useTaskBatchActions();
  const { allowed: canEdit } = usePermission('create_content');
  const activeWorkspaceId = useActiveWorkspaceId();
  const userId = useUserStore(userProfileSelectors.userId);
  const [page, setPage] = useState<Page>();
  const [search, setSearch] = useState('');

  // The same agents, in the same groups, as the single-task picker. Private
  // agents get their own scope; picking one makes the selection's public
  // tasks private first, behind a confirmation (see `assignAgent`).
  const { inboxAgent, privateAgentIds, recentIds, rememberAssignee, scopes } =
    useAssigneeAgentScopes({
      offerPrivate: true,
      privateTitle: t('taskManager.agentSelector.privateGroup', { ns: 'topic' }),
    });
  const recentAgents = useMemo(
    () =>
      pickRecentAssignees(
        recentIds,
        scopes.flatMap((scope) => scope.sections.flatMap((section) => section.agents)),
      ),
    [recentIds, scopes],
  );
  const agentGroups = useMemo(
    () =>
      scopes.flatMap((scope) =>
        scope.sections.map((section) => ({
          agents: section.agents,
          // cmdk groups do not nest, so a section names its scope too.
          heading: [scope.title, section.title].filter(Boolean).join(' · ') || undefined,
          id: section.id,
        })),
      ),
    [scopes],
  );

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

  const assignAgent = (agent: SidebarAgentItem) => {
    const action = { kind: 'update', patch: { assigneeAgentId: agent.id } } as const;
    const targets = privateAgentIds.has(agent.id)
      ? pickTasksToPrivatize(selectedTasks, userId)
      : [];
    if (targets.length === 0) {
      rememberAssignee(agent.id);
      act(action);
      return;
    }

    onClose();
    // A public task only takes a private agent once it is private itself. The
    // single-task picker asks before doing that; so does the batch, instead of
    // letting the server skip every public task.
    const takeOverCount = targets.filter((target) => target.takeOwnership).length;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: (
        <BulkAssignPrivateConfirmContent count={targets.length} takeOverCount={takeOverCount} />
      ),
      okButtonProps: { danger: true },
      okText: t('taskList.bulk.assignPrivate.ok'),
      onOk: () => {
        // Recent records what was assigned, so a cancelled pick leaves it alone.
        rememberAssignee(agent.id);
        void run(action, {
          prepare: (ids) => {
            const selected = new Set(ids);
            return privatizeTasks(targets.filter((target) => selected.has(target.id)));
          },
        });
      },
      title: t('taskList.bulk.assignPrivate.title', { count: selectedIds.length }),
    });
  };

  const renderAgent = (agent: SidebarAgentItem, sectionId: string) => {
    const name = agentDisplayName(agent) ?? agent.id;
    return (
      <Item
        disabled={disabled}
        key={`${sectionId}:${agent.id}`}
        label={name}
        // An agent can be listed under Recent and its group; values stay unique.
        value={`agent ${sectionId} ${agent.id} ${name}`}
        icon={
          <AgentAvatar
            agentId={agent.id}
            avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
            name={name}
            shape={'square'}
            size={20}
          />
        }
        onSelect={() => assignAgent(agent)}
      />
    );
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
    <div className={styles.overlay} onClick={onClose}>
      <div onClick={stopPropagation}>
        <Command
          className={styles.commandRoot}
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
          <div className={styles.contextWrapper}>
            {page && (
              <Tag
                className={styles.backTag}
                icon={<ArrowLeft size={12} />}
                onClick={() => goTo()}
              />
            )}
            <Tag className={styles.contextTag}>
              {t('taskList.bulk.count', { count: selectedIds.length })}
            </Tag>
          </div>
          <div className={styles.inputWrapper}>
            <Command.Input
              autoFocus
              placeholder={placeholder}
              value={search}
              onValueChange={setSearch}
            />
          </div>
          <Command.List>
            <Command.Empty>{t('taskList.bulk.noResults')}</Command.Empty>

            {!page && (
              <Command.Group>
                <Item
                  disabled={disabled}
                  icon={<Icon className={styles.icon} icon={CircleDashedIcon} />}
                  label={t('taskList.bulk.changeStatus')}
                  value={'change status'}
                  onSelect={() => goTo('status')}
                />
                <Item
                  disabled={disabled}
                  icon={<Icon className={styles.icon} icon={BarChart3Icon} />}
                  label={t('taskList.bulk.setPriority')}
                  value={'set priority'}
                  onSelect={() => goTo('priority')}
                />
                <Item
                  disabled={disabled}
                  icon={<Icon className={styles.icon} icon={BotIcon} />}
                  label={t('taskList.bulk.assignAgent')}
                  value={'assign agent'}
                  onSelect={() => goTo('agent')}
                />
                {hasWorkspaceMemberDirectory(activeWorkspaceId) && userId && (
                  <>
                    <Item
                      disabled={disabled}
                      icon={<Icon className={styles.icon} icon={UserRoundCheckIcon} />}
                      label={t('taskList.bulk.assignToMe')}
                      value={'assign to me'}
                      onSelect={() => act({ kind: 'update', patch: { assigneeUserId: userId } })}
                    />
                    <Item
                      disabled={disabled}
                      icon={<Icon className={styles.icon} icon={UserRoundXIcon} />}
                      label={t('taskList.bulk.unassignMember')}
                      value={'unassign member'}
                      onSelect={() => act({ kind: 'update', patch: { assigneeUserId: null } })}
                    />
                  </>
                )}
                {allArchived ? (
                  <Item
                    disabled={disabled}
                    icon={<Icon className={styles.icon} icon={ArchiveRestoreIcon} />}
                    label={t('taskList.bulk.unarchive')}
                    value={'unarchive restore'}
                    onSelect={() => act({ archived: false, kind: 'archive' })}
                  />
                ) : (
                  <Item
                    disabled={disabled || !anyArchivable}
                    icon={<Icon className={styles.icon} icon={ArchiveIcon} />}
                    label={t('taskList.bulk.archive')}
                    value={'archive'}
                    onSelect={() => act({ archived: true, kind: 'archive' })}
                  />
                )}
                <Item
                  icon={<Icon className={styles.icon} icon={CopyIcon} />}
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
                    <Icon className={styles.icon} color={cssVar.colorError} icon={Trash2Icon} />
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
                      icon={<Icon className={styles.icon} color={meta.color} icon={meta.icon} />}
                      key={status}
                      label={statusLabel(status)}
                      value={`status ${status} ${statusLabel(status)}`}
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
              <>
                <Command.Group>
                  <Item
                    disabled={disabled}
                    icon={<Icon className={styles.icon} icon={UserRoundXIcon} />}
                    label={t('taskList.bulk.unassignAgent')}
                    value={'unassigned none'}
                    onSelect={() => act({ kind: 'update', patch: { assigneeAgentId: null } })}
                  />
                  {inboxAgent && renderAgent(inboxAgent, 'inbox')}
                </Command.Group>
                {/* Recent only helps before typing; a search lists each match once. */}
                {!search && recentAgents.length > 0 && (
                  <Command.Group
                    heading={t('taskManager.agentSelector.recentGroup', { ns: 'topic' })}
                  >
                    {recentAgents.map((agent) => renderAgent(agent, 'recent'))}
                  </Command.Group>
                )}
                {agentGroups.map((group) => (
                  <Command.Group heading={group.heading} key={group.id}>
                    {group.agents.map((agent) => renderAgent(agent, group.id))}
                  </Command.Group>
                ))}
              </>
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
