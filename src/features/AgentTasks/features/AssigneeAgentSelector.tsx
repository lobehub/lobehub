import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { canWorkspaceRoleBeTaskAssignee } from '@lobechat/const/rbac';
import { agentDisplayName } from '@lobechat/types';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { UserRoundX } from 'lucide-react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import Avatar from '@/components/Avatar';
import { type SidebarAgentItem } from '@/database/repositories/home';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import AgentItem from '@/features/PageEditor/Copilot/AgentSelector/AgentItem';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useTaskStore } from '@/store/task';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

/**
 * What the picker commits: exactly one of the two ids is set, or both are null
 * (Unassigned). The DB allows the pair to coexist, but every UI write keeps
 * them mutually exclusive so "who is this task assigned to" has one answer.
 */
export interface TaskAssigneePayload {
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
}

interface AssigneeAgentSelectorProps {
  children: ReactNode;
  currentAgentId?: string | null;
  currentUserId?: string | null;
  disabled?: boolean;
  /**
   * Hide the Members section entirely. Used for tasks where a human assignee
   * makes no sense regardless of who it is — e.g. automated
   * (heartbeat/schedule) tasks, which always execute through an agent.
   */
  hideMembers?: boolean;
  onChange?: (assignee: TaskAssigneePayload) => void;
  /**
   * Creator of the task being reassigned. Only meaningful together with
   * `taskVisibility`; defaults to the signed-in user (create flows).
   */
  taskCreatorId?: string | null;
  taskIdentifier?: string;
  /**
   * Visibility of the task being assigned. A private task is visible to its
   * creator only, so every other member row is hidden — assigning someone a
   * task they can never see is a dead end the server rejects anyway. A public
   * task conversely hides the Private agents section.
   */
  taskVisibility?: 'private' | 'public' | null;
}

// Derive the member row from the hook so the selector stays aligned with its
// public data contract without duplicating an implementation-specific type.
type WorkspaceMemberRow = ReturnType<typeof useWorkspaceMembers>[number];

type AssigneeOption =
  | { key: 'unassigned'; kind: 'unassigned' }
  | { key: string; kind: 'member'; member: WorkspaceMemberRow }
  | { agent: SidebarAgentItem; key: string; kind: 'agent' };

const styles = createStaticStyles(({ css, cssVar }) => ({
  searchInput: css`
    width: 100%;
    padding-block: 6px;
    padding-inline: 10px;
    border: none;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: inherit;
    font-size: 13px;
    color: ${cssVar.colorText};

    background: transparent;
    outline: none;

    &::placeholder {
      color: ${cssVar.colorTextPlaceholder};
    }
  `,
  sectionHeader: css`
    padding-block: 4px;
    padding-inline: 8px;

    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextTertiary};
  `,
}));

// Both labels rendered on a row are searchable: the name and the role shown
// beside it, so typing a role ("设计") finds the agent the user sees.
const matchesSearch = (agent: SidebarAgentItem, q: string) =>
  [agentDisplayName(agent), agent.title].some((label) => (label ?? '').toLowerCase().includes(q));

// Same display-name fallback chain the workspace member table uses.
const memberName = (member: WorkspaceMemberRow) =>
  member.user?.fullName?.trim() ||
  member.user?.username?.trim() ||
  member.user?.email?.trim() ||
  member.userId;

const matchesMemberSearch = (member: WorkspaceMemberRow, q: string) =>
  [member.user?.fullName, member.user?.username, member.user?.email].some((label) =>
    (label ?? '').toLowerCase().includes(q),
  );

const triggerStyle: CSSProperties = {
  alignItems: 'center',
  display: 'inline-flex',
  justifyContent: 'center',
  lineHeight: 1,
  // Bound the trigger to its row so a chip inside it can cap at `max-width:
  // 100%` and ellipsis its label, instead of overflowing a narrow column.
  maxWidth: '100%',
  minWidth: 0,
};

const AssigneeAgentSelector = memo<AssigneeAgentSelectorProps>(
  ({
    children,
    currentAgentId,
    currentUserId,
    disabled,
    hideMembers,
    onChange,
    taskCreatorId,
    taskIdentifier,
    taskVisibility,
  }) => {
    const { t } = useTranslation(['chat', 'common', 'topic']);
    const { allowed: canEditTask, reason } = usePermission('create_content');
    const [key, setKey] = useState(0);
    const [search, setSearch] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const updateTask = useTaskStore((s) => s.updateTask);
    const pinnedAgents = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);
    const agentGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
    const ungroupedAgents = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);
    const privateAgentGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
    const privatePinnedAgents = useHomeStore(homeAgentListSelectors.privatePinnedAgents, isEqual);
    const privateUngroupedAgents = useHomeStore(
      homeAgentListSelectors.privateUngroupedAgents,
      isEqual,
    );
    const hasPrivateAgents = useHomeStore(homeAgentListSelectors.hasPrivateAgents);
    const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);

    const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
    const inboxMeta = useAgentStore((s) =>
      inboxAgentId ? agentSelectors.getAgentMetaById(inboxAgentId)(s) : undefined,
    );

    useFetchAgentList();
    // Member discovery is optional; implementations that do not provide a
    // member list return an empty collection and omit the section naturally.
    useFetchWorkspaceMembers();
    const allMembers = useWorkspaceMembers();

    // A private task can only be assigned to its creator (create flows have no
    // creator yet, so the signed-in user stands in) — every other member row
    // is hidden, matching the hidden Members section on automated tasks.
    const selfUserId = useUserStore(userProfileSelectors.userId);
    const creatorId = taskCreatorId ?? selfUserId;
    const isPrivateTask = taskVisibility === 'private';
    const members = useMemo(() => {
      if (hideMembers) return [];
      const assignableMembers = allMembers.filter((member) =>
        canWorkspaceRoleBeTaskAssignee(member.role),
      );
      if (isPrivateTask) {
        return assignableMembers.filter((member) => member.userId === creatorId);
      }
      return assignableMembers;
    }, [hideMembers, isPrivateTask, creatorId, allMembers]);

    // Workspace bucket: pinned + grouped + ungrouped. In personal mode this is the
    // entire list (private buckets stay empty). The inbox agent is shared content,
    // so it is injected at the top of this bucket when missing.
    const workspaceAgents = useMemo<SidebarAgentItem[]>(() => {
      const groupedItems = agentGroups.flatMap((group) => group.items);
      const available = [...pinnedAgents, ...groupedItems, ...ungroupedAgents].filter(
        (agent) => agent.type === 'agent',
      );
      const hasInbox = available.some((agent) => agent.id === inboxAgentId);

      if (inboxAgentId && !hasInbox) {
        return [
          {
            avatar: inboxMeta?.avatar || DEFAULT_INBOX_AVATAR,
            description: null,
            id: inboxAgentId,
            pinned: false,
            title: agentDisplayName(inboxMeta, t('inbox.title', { ns: 'chat' })),
            type: 'agent' as const,
            updatedAt: new Date(),
          },
          ...available,
        ];
      }

      return available;
    }, [pinnedAgents, agentGroups, ungroupedAgents, inboxAgentId, inboxMeta, t]);

    // A public (workspace-visible) task can never be assigned to a private
    // agent — the server rejects the pair — so hide the Private section for
    // existing public tasks instead of offering dead rows. Create flows keep
    // it: picking a private agent there flips the new task to private.
    const hidePrivateAgents = taskVisibility === 'public';

    const privateAgents = useMemo<SidebarAgentItem[]>(() => {
      if (hidePrivateAgents) return [];
      const groupedItems = privateAgentGroups.flatMap((group) => group.items);
      return [...privatePinnedAgents, ...groupedItems, ...privateUngroupedAgents].filter(
        (agent) => agent.type === 'agent',
      );
    }, [hidePrivateAgents, privateAgentGroups, privatePinnedAgents, privateUngroupedAgents]);

    const query = search.trim().toLowerCase();

    const filteredPrivate = useMemo(() => {
      if (!query) return privateAgents;
      return privateAgents.filter((agent) => matchesSearch(agent, query));
    }, [privateAgents, query]);

    const filteredWorkspace = useMemo(() => {
      if (!query) return workspaceAgents;
      return workspaceAgents.filter((agent) => matchesSearch(agent, query));
    }, [workspaceAgents, query]);

    const filteredMembers = useMemo(() => {
      if (!query) return members;
      return members.filter((member) => matchesMemberSearch(member, query));
    }, [members, query]);

    const unassignedLabel = t('taskList.unassigned', { ns: 'chat' });
    const showUnassigned = !query || unassignedLabel.toLowerCase().includes(query);

    // Flat order for keyboard navigation and activeIndex: Unassigned, then
    // members, then agents (private before workspace, mirroring the sections).
    const flatOptions = useMemo<AssigneeOption[]>(() => {
      const agents = hasPrivateAgents
        ? [...filteredPrivate, ...filteredWorkspace]
        : filteredWorkspace;
      return [
        ...(showUnassigned ? [{ key: 'unassigned', kind: 'unassigned' } as const] : []),
        ...filteredMembers.map(
          (member) => ({ key: `member:${member.userId}`, kind: 'member', member }) as const,
        ),
        ...agents.map((agent) => ({ agent, key: `agent:${agent.id}`, kind: 'agent' }) as const),
      ];
    }, [showUnassigned, filteredMembers, hasPrivateAgents, filteredPrivate, filteredWorkspace]);

    const selectedKey = currentAgentId
      ? `agent:${currentAgentId}`
      : currentUserId
        ? `member:${currentUserId}`
        : 'unassigned';

    useEffect(() => {
      if (search.trim()) {
        setActiveIndex(0);
        return;
      }
      const selectedIdx = flatOptions.findIndex((option) => option.key === selectedKey);
      setActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
    }, [search, flatOptions, selectedKey]);

    const handleSelect = useCallback(
      (option: AssigneeOption) => {
        if (!canEditTask) return;
        if (option.key === selectedKey) return;

        const payload: TaskAssigneePayload =
          option.kind === 'agent'
            ? { assigneeAgentId: option.agent.id, assigneeUserId: null }
            : option.kind === 'member'
              ? { assigneeAgentId: null, assigneeUserId: option.member.userId }
              : { assigneeAgentId: null, assigneeUserId: null };

        setKey((k) => k + 1);
        setSearch('');
        if (onChange) {
          onChange(payload);
          return;
        }
        if (taskIdentifier) {
          void updateTask(taskIdentifier, payload);
        }
      },
      [canEditTask, selectedKey, onChange, taskIdentifier, updateTask],
    );

    const handleSearchKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        if (flatOptions.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % flatOptions.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + flatOptions.length) % flatOptions.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const target = flatOptions[activeIndex];
          if (target) handleSelect(target);
        }
      },
      [activeIndex, flatOptions, handleSelect],
    );

    useEffect(() => {
      const list = listRef.current;
      if (!list) return;
      const active = list.querySelector<HTMLElement>(`[data-agent-index="${activeIndex}"]`);
      active?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const flatIndexByKey = useMemo(() => {
      const map = new Map<string, number>();
      flatOptions.forEach((option, index) => map.set(option.key, index));
      return map;
    }, [flatOptions]);

    const renderOption = (option: AssigneeOption) => {
      const flatIndex = flatIndexByKey.get(option.key) ?? 0;
      const active = flatIndex === activeIndex;
      const row =
        option.kind === 'agent' ? (
          <AgentItem
            active={active}
            agent={option.agent}
            agentId={option.agent.id}
            agentTitle={agentDisplayName(option.agent, t('untitledAgent', { ns: 'chat' }))}
            avatar={option.agent.avatar}
            onAgentChange={() => handleSelect(option)}
            onClose={() => setKey((k) => k + 1)}
          />
        ) : (
          <NavItem
            active={active}
            style={{ flexShrink: 0 }}
            title={option.kind === 'member' ? memberName(option.member) : unassignedLabel}
            icon={
              option.kind === 'member' ? (
                <Avatar
                  avatar={option.member.user?.avatar || undefined}
                  name={memberName(option.member)}
                  shape={'circle'}
                  size={22}
                />
              ) : (
                <Icon color={cssVar.colorTextDescription} icon={UserRoundX} size={18} />
              )
            }
            onClick={() => handleSelect(option)}
          />
        );

      return (
        <div
          data-agent-index={flatIndex}
          key={option.key}
          onMouseEnter={() => setActiveIndex(flatIndex)}
        >
          {row}
        </div>
      );
    };

    const renderAgents = (list: SidebarAgentItem[]) =>
      list.map((agent) => renderOption({ agent, key: `agent:${agent.id}`, kind: 'agent' }));

    const hasMemberSection = filteredMembers.length > 0;
    const agentSectionHeader = hasPrivateAgents
      ? t('taskManager.agentSelector.workspaceGroup', { ns: 'topic' })
      : hasMemberSection
        ? t('taskList.assigneeSelector.agentGroup', { ns: 'chat' })
        : null;

    const blocked = disabled || !canEditTask;
    const trigger = blocked ? (
      <Tooltip title={disabled ? t('taskDetail.reassignDisabled', { ns: 'chat' }) : reason}>
        <div
          style={{ ...triggerStyle, cursor: 'not-allowed', opacity: 0.5 }}
          onClick={(e) => e.stopPropagation()}
        >
          <span style={{ pointerEvents: 'none' }}>{children}</span>
        </div>
      </Tooltip>
    ) : (
      <div style={triggerStyle} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    );

    return (
      <Popover
        disabled={blocked}
        key={key}
        placement="bottomLeft"
        styles={{ content: { padding: 0, width: 260 } }}
        trigger="click"
        content={
          <Suspense fallback={<SkeletonList rows={6} />}>
            {isAgentListInit ? (
              <Flexbox onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  className={styles.searchInput}
                  placeholder={t('taskList.assigneeSearch.placeholder', { ns: 'chat' })}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                {flatOptions.length === 0 ? (
                  <Flexbox align={'center'} justify={'center'} padding={16}>
                    <Text fontSize={12} type={'secondary'}>
                      {t('taskList.assigneeSearch.empty', { ns: 'chat' })}
                    </Text>
                  </Flexbox>
                ) : (
                  <Flexbox
                    gap={4}
                    padding={8}
                    ref={listRef}
                    style={{ maxHeight: '50vh', overflowY: 'auto', width: '100%' }}
                  >
                    {showUnassigned && renderOption({ key: 'unassigned', kind: 'unassigned' })}
                    {hasMemberSection && (
                      <>
                        <div className={styles.sectionHeader}>
                          {t('taskList.assigneeSelector.memberGroup', { ns: 'chat' })}
                        </div>
                        {filteredMembers.map((member) =>
                          renderOption({ key: `member:${member.userId}`, kind: 'member', member }),
                        )}
                      </>
                    )}
                    {hasPrivateAgents && filteredPrivate.length > 0 && (
                      <>
                        <div className={styles.sectionHeader}>
                          {t('taskManager.agentSelector.privateGroup', { ns: 'topic' })}
                        </div>
                        {renderAgents(filteredPrivate)}
                      </>
                    )}
                    {filteredWorkspace.length > 0 && (
                      <>
                        {agentSectionHeader && (
                          <div className={styles.sectionHeader}>{agentSectionHeader}</div>
                        )}
                        {renderAgents(filteredWorkspace)}
                      </>
                    )}
                  </Flexbox>
                )}
              </Flexbox>
            ) : (
              <SkeletonList rows={6} />
            )}
          </Suspense>
        }
      >
        {trigger}
      </Popover>
    );
  },
);

export default AssigneeAgentSelector;
