import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { confirmModal, Flexbox, Icon, Popover, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronRight, UserRoundX } from 'lucide-react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { type SidebarAgentItem } from '@/database/repositories/home';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import AgentItem from '@/features/PageEditor/Copilot/AgentSelector/AgentItem';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useTaskStore } from '@/store/task';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import {
  type AssigneeAgentSection,
  buildAssigneeAgentSections,
  filterAssigneeSections,
  matchesAssigneeSearch,
  pickRecentAssignees,
  pushRecentAssignee,
  shouldOfferPrivateAgents,
} from './assigneeAgentSections';

interface AssigneeAgentSelectorProps {
  /** Offer the "unassigned" option; off where an owner is required. */
  allowUnassigned?: boolean;
  /** Stretch the trigger to the container width, e.g. as a form field. */
  block?: boolean;
  children: ReactNode;
  currentAgentId?: string | null;
  disabled?: boolean;
  /** Why `disabled` holds; defaults to the running-Task explanation. */
  disabledReason?: string;
  onChange?: (agentId: string | null) => void;
  /**
   * The task's creator. On a public task, lets its creator pick a private
   * agent: confirming makes the task private first, then assigns it.
   */
  taskCreatorId?: string | null;
  taskIdentifier?: string;
  taskVisibility?: 'private' | 'public' | null;
}

type AgentOption =
  | { key: 'unassigned'; kind: 'unassigned' }
  | { agent: SidebarAgentItem; key: string; kind: 'agent' };

type PickerRow =
  | { kind: 'option'; option: AgentOption }
  | { key: string; kind: 'scope'; title: string }
  | {
      collapsed: boolean;
      collapsible: boolean;
      count: number;
      id: string;
      kind: 'section';
      title: string;
    };

interface PickerScope {
  id: string;
  sections: AssigneeAgentSection[];
  title?: string;
}

const RECENT_SECTION_ID = 'recent';

const styles = stylex.create({
  searchInput: {
    'width': '100%',
    'paddingBlock': '6px',
    'paddingInline': '10px',
    'borderStyle': 'none',
    'borderBlockEndWidth': '1px',
    'borderBlockEndStyle': 'solid',
    'borderBlockEndColor': cssVar.colorBorderSecondary,
    'fontFamily': 'inherit',
    'fontSize': '13px',
    'color': cssVar.colorText,
    'backgroundColor': 'transparent',
    'backgroundImage': 'none',
    'outlineStyle': 'none',
    '::placeholder': { color: cssVar.colorTextPlaceholder },
  },
  sectionHeader: {
    paddingBlock: '4px',
    paddingInline: '8px',
    fontSize: '12px',
    lineHeight: 1.4,
    color: cssVar.colorTextTertiary,
  },
  sectionToggle: {
    cursor: 'pointer',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    width: '100%',
    paddingBlock: '4px',
    paddingInlineStart: '4px',
    paddingInlineEnd: '8px',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadiusSM,
    fontFamily: 'inherit',
    fontSize: '12px',
    lineHeight: 1.4,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  sectionToggleTitle: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});
const triggerStyle: CSSProperties = {
  alignItems: 'center',
  display: 'inline-flex',
  justifyContent: 'center',
  lineHeight: 1,
  maxWidth: '100%',
  minWidth: 0,
};

// `display: contents` keeps the disabled wrapper out of layout, so the trigger
// lays out exactly as when enabled (e.g. a full-width property row stays
// left-aligned instead of shrinking and being centered).
const blockedContentStyle: CSSProperties = { display: 'contents', pointerEvents: 'none' };

const AssigneeAgentSelector = memo<AssigneeAgentSelectorProps>(
  ({
    allowUnassigned = true,
    block,
    children,
    currentAgentId,
    disabled,
    disabledReason,
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
    const keyboardMovedRef = useRef(false);

    const updateTask = useTaskStore((s) => s.updateTask);
    const updateTaskVisibility = useTaskStore((s) => s.updateTaskVisibility);
    const currentUserId = useUserStore(userProfileSelectors.userId);
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

    const workspaceId = useActiveWorkspaceId();
    const recentKey = workspaceId ?? 'personal';
    const recentIds = useGlobalStore((s) => s.status.recentAssigneeAgentIds?.[recentKey]);
    const collapsedGroups = useGlobalStore((s) => s.status.assigneeAgentSelectorCollapsedGroups);
    const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

    const {
      offer: offerPrivateAgents,
      privatizes: offerPrivateOnPublic,
      takesOver,
    } = shouldOfferPrivateAgents({
      currentUserId,
      hasOnChange: !!onChange,
      taskCreatorId,
      taskIdentifier,
      taskVisibility,
      workspaceId,
    });

    const scopes = useMemo<PickerScope[]>(() => {
      const labels = {
        pinned: t('navPanel.pinned', { ns: 'common' }),
        ungrouped: t('defaultList', { ns: 'chat' }),
      };
      const result: PickerScope[] = [];

      if (offerPrivateAgents)
        result.push({
          id: 'private',
          sections: buildAssigneeAgentSections({
            groups: privateAgentGroups,
            labels,
            pinned: privatePinnedAgents,
            scope: 'private',
            ungrouped: privateUngroupedAgents,
          }),
          title: takesOver
            ? t('taskManager.agentSelector.privateGroupTakesOver', { ns: 'topic' })
            : offerPrivateOnPublic
              ? t('taskManager.agentSelector.privateGroupMakesPrivate', { ns: 'topic' })
              : t('taskManager.agentSelector.privateGroup', { ns: 'topic' }),
        });

      const workspaceSections = buildAssigneeAgentSections({
        groups: agentGroups,
        labels,
        pinned: pinnedAgents,
        scope: 'workspace',
        ungrouped: ungroupedAgents,
      });
      result.push({
        id: 'workspace',
        sections: workspaceSections,
        title: hasPrivateAgents
          ? t('taskManager.agentSelector.workspaceGroup', { ns: 'topic' })
          : undefined,
      });

      return result;
    }, [
      agentGroups,
      hasPrivateAgents,
      offerPrivateAgents,
      offerPrivateOnPublic,
      pinnedAgents,
      privateAgentGroups,
      privatePinnedAgents,
      privateUngroupedAgents,
      t,
      takesOver,
      ungroupedAgents,
    ]);

    // The sidebar keeps the inbox above every group, so it leads the list here
    // too, ahead of Recent, where a header-less row would read as a recent pick.
    const inboxAgent = useMemo<SidebarAgentItem | undefined>(() => {
      if (!inboxAgentId) return;
      const listed = scopes.some((scope) =>
        scope.sections.some((section) => section.agents.some((agent) => agent.id === inboxAgentId)),
      );
      if (listed) return;
      return {
        avatar: inboxMeta?.avatar || DEFAULT_INBOX_AVATAR,
        description: null,
        id: inboxAgentId,
        pinned: false,
        title: agentDisplayName(inboxMeta, t('inbox.title', { ns: 'chat' })),
        type: 'agent' as const,
        updatedAt: new Date(),
      };
    }, [inboxAgentId, inboxMeta, scopes, t]);

    const query = search.trim().toLowerCase();
    const recentAgents = useMemo(
      () =>
        query
          ? []
          : // A standalone inbox already has its own row above Recent; offering
            // it here too would list it twice.
            pickRecentAssignees(
              recentIds,
              scopes.flatMap((scope) => scope.sections.flatMap((section) => section.agents)),
            ),
      [query, recentIds, scopes],
    );

    const unassignedLabel = t('taskList.unassigned', { ns: 'chat' });
    const showUnassigned =
      allowUnassigned && (!query || unassignedLabel.toLowerCase().includes(query));

    // One ordered list of headers and options; the options alone drive the
    // keyboard. An agent can sit in both Recent and its group, so option keys
    // carry the section id.
    const rows = useMemo<PickerRow[]>(() => {
      const result: PickerRow[] = [];
      const pushAgents = (sectionId: string, agents: SidebarAgentItem[]) => {
        for (const agent of agents)
          result.push({
            kind: 'option',
            option: { agent, key: `${sectionId}:${agent.id}`, kind: 'agent' },
          });
      };

      if (showUnassigned)
        result.push({ kind: 'option', option: { key: 'unassigned', kind: 'unassigned' } });
      if (inboxAgent && (!query || matchesAssigneeSearch(inboxAgent, query)))
        pushAgents('inbox', [inboxAgent]);

      if (recentAgents.length > 0) {
        result.push({
          collapsed: false,
          collapsible: false,
          count: recentAgents.length,
          id: RECENT_SECTION_ID,
          kind: 'section',
          title: t('taskManager.agentSelector.recentGroup', { ns: 'topic' }),
        });
        pushAgents(RECENT_SECTION_ID, recentAgents);
      }

      for (const scope of scopes) {
        const sections = filterAssigneeSections(scope.sections, query);
        if (sections.length === 0) continue;
        if (scope.title) result.push({ key: scope.id, kind: 'scope', title: scope.title });

        for (const section of sections) {
          // A search reaches into folded groups, otherwise a match would hide.
          const collapsed = section.collapsible && !query && !!collapsedGroups?.[section.id];
          if (section.title)
            result.push({
              collapsed,
              // While searching every match shows, so there is nothing to fold.
              collapsible: section.collapsible && !query,
              count: section.agents.length,
              id: section.id,
              kind: 'section',
              title: section.title,
            });
          if (!collapsed) pushAgents(section.id, section.agents);
        }
      }

      return result;
    }, [collapsedGroups, inboxAgent, query, recentAgents, scopes, showUnassigned, t]);

    const flatOptions = useMemo(
      () => rows.flatMap((row) => (row.kind === 'option' ? [row.option] : ([] as AgentOption[]))),
      [rows],
    );

    const toggleSection = useCallback(
      (sectionId: string, collapsed: boolean) =>
        updateSystemStatus({ assigneeAgentSelectorCollapsedGroups: { [sectionId]: !collapsed } }),
      [updateSystemStatus],
    );

    useEffect(() => {
      if (query) {
        setActiveIndex(0);
        return;
      }
      const selectedIndex = flatOptions.findIndex((option) =>
        option.kind === 'agent' ? option.agent.id === currentAgentId : !currentAgentId,
      );
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }, [currentAgentId, flatOptions, query]);

    const privateAgentIds = useMemo(
      () =>
        new Set(
          scopes
            .find((scope) => scope.id === 'private')
            ?.sections.flatMap((section) => section.agents.map((agent) => agent.id)),
        ),
      [scopes],
    );

    const assignAgent = useCallback(
      (agentId: string | null, agent?: SidebarAgentItem) => {
        if (agentId) {
          const current = useGlobalStore.getState().status.recentAssigneeAgentIds?.[recentKey];
          updateSystemStatus({
            recentAssigneeAgentIds: { [recentKey]: pushRecentAssignee(current, agentId) },
          });
        }
        if (onChange) {
          onChange(agentId);
          return;
        }
        if (!taskIdentifier) return;
        return updateTask(
          taskIdentifier,
          { assigneeAgentId: agentId },
          // The picker is the one place that already holds the chosen agent's
          // display metadata, so it hands it over for the optimistic feed row.
          {
            optimisticAssignee: agent
              ? {
                  // A group agent carries a member-avatar list; the feed row
                  // only knows how to draw a single image.
                  avatar: typeof agent.avatar === 'string' ? agent.avatar : null,
                  id: agent.id,
                  name: agentDisplayName(agent),
                  type: 'agent',
                }
              : undefined,
          },
        );
      },
      [onChange, recentKey, taskIdentifier, updateSystemStatus, updateTask],
    );

    const handleAgentChange = useCallback(
      (agentId: string | null, agent?: SidebarAgentItem) => {
        if (!canEditTask || agentId === (currentAgentId ?? null)) return;
        setKey((value) => value + 1);
        setSearch('');

        if (!offerPrivateOnPublic || !taskIdentifier || !agentId || !privateAgentIds.has(agentId)) {
          void assignAgent(agentId, agent);
          return;
        }

        // The task goes private before the private agent is assigned; if that
        // fails, the store has already explained why and nothing is assigned.
        // Someone else's task becomes the picker's own private task.
        const copy = takesOver
          ? {
              hint: t('taskManager.agentSelector.takeOverConfirm.hint', { ns: 'topic' }),
              ok: t('taskManager.agentSelector.takeOverConfirm.ok', { ns: 'topic' }),
              title: t('taskManager.agentSelector.takeOverConfirm.title', { ns: 'topic' }),
            }
          : {
              hint: t('taskManager.agentSelector.makePrivateConfirm.hint', { ns: 'topic' }),
              ok: t('taskManager.agentSelector.makePrivateConfirm.ok', { ns: 'topic' }),
              title: t('taskManager.agentSelector.makePrivateConfirm.title', { ns: 'topic' }),
            };
        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: (
            <>
              <VisibilityConfirmContent variant="makePrivate" />
              <div style={{ marginTop: 8, opacity: 0.7 }}>{copy.hint}</div>
            </>
          ),
          okButtonProps: { danger: true },
          okText: copy.ok,
          onOk: async () => {
            try {
              await (takesOver
                ? updateTaskVisibility(taskIdentifier, 'private', { takeOwnership: true })
                : updateTaskVisibility(taskIdentifier, 'private'));
            } catch {
              // The store action already surfaced a targeted toast; swallow so
              // the confirm modal doesn't bubble a second error to base-ui.
              return;
            }
            await assignAgent(agentId, agent);
          },
          title: copy.title,
        });
      },
      [
        assignAgent,
        canEditTask,
        currentAgentId,
        offerPrivateOnPublic,
        privateAgentIds,
        t,
        takesOver,
        taskIdentifier,
        updateTaskVisibility,
      ],
    );

    const handleSelect = useCallback(
      (option: AgentOption) =>
        option.kind === 'agent'
          ? handleAgentChange(option.agent.id, option.agent)
          : handleAgentChange(null),
      [handleAgentChange],
    );

    const handleSearchKeyDown = useCallback(
      (event: KeyboardEvent<HTMLInputElement>) => {
        if (flatOptions.length === 0) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          keyboardMovedRef.current = true;
          setActiveIndex((index) => (index + 1) % flatOptions.length);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          keyboardMovedRef.current = true;
          setActiveIndex((index) => (index - 1 + flatOptions.length) % flatOptions.length);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          const target = flatOptions[activeIndex];
          if (target) handleSelect(target);
        }
      },
      [activeIndex, flatOptions, handleSelect],
    );

    // Follow the highlight only when the arrow keys moved it. Folding a group
    // shifts every index after it, and scrolling then jumped the list away.
    useEffect(() => {
      if (!keyboardMovedRef.current) return;
      keyboardMovedRef.current = false;
      const active = listRef.current?.querySelector<HTMLElement>(
        `[data-assignee-index="${activeIndex}"]`,
      );
      active?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const optionIndexByKey = useMemo(
      () => new Map(flatOptions.map((option, index) => [option.key, index])),
      [flatOptions],
    );
    const renderOption = (option: AgentOption) => {
      const optionIndex = optionIndexByKey.get(option.key) ?? 0;
      const active = optionIndex === activeIndex;
      const agentTitle =
        option.kind === 'agent'
          ? agentDisplayName(option.agent, t('untitledAgent', { ns: 'chat' }))
          : undefined;
      return (
        <div
          data-assignee-index={optionIndex}
          key={option.key}
          // Long names truncate; the native tooltip keeps similar ones apart.
          title={agentTitle}
          onMouseEnter={() => setActiveIndex(optionIndex)}
        >
          {option.kind === 'agent' ? (
            <AgentItem
              active={active}
              agent={option.agent}
              agentId={option.agent.id}
              agentTitle={agentTitle ?? ''}
              avatar={option.agent.avatar}
              onAgentChange={() => handleSelect(option)}
              onClose={() => setKey((value) => value + 1)}
            />
          ) : (
            <NavItem
              active={active}
              icon={<Icon color={cssVar.colorTextDescription} icon={UserRoundX} size={18} />}
              style={{ flexShrink: 0 }}
              title={unassignedLabel}
              onClick={() => handleSelect(option)}
            />
          )}
        </div>
      );
    };

    const renderRow = (row: PickerRow) => {
      if (row.kind === 'option') return renderOption(row.option);
      if (row.kind === 'scope')
        return (
          <div className={stylex.props(styles.sectionHeader).className} key={`scope:${row.key}`}>
            {row.title}
          </div>
        );
      if (!row.collapsible)
        return (
          <div className={stylex.props(styles.sectionHeader).className} key={`section:${row.id}`}>
            {row.title}
          </div>
        );
      return (
        <button
          aria-expanded={!row.collapsed}
          className={stylex.props(styles.sectionToggle).className}
          key={`section:${row.id}`}
          type={'button'}
          onClick={() => toggleSection(row.id, row.collapsed)}
          // Keep focus in the search box so the arrow keys still move the list.
          onMouseDown={(event) => event.preventDefault()}
        >
          <Icon icon={row.collapsed ? ChevronRight : ChevronDown} size={14} />
          <span className={stylex.props(styles.sectionToggleTitle).className}>{row.title}</span>
          {row.collapsed && <span>{row.count}</span>}
        </button>
      );
    };

    const blocked = disabled || !canEditTask;
    const baseTriggerStyle = block ? { ...triggerStyle, display: 'flex' } : triggerStyle;
    const trigger = blocked ? (
      <Tooltip
        title={
          disabled ? (disabledReason ?? t('taskDetail.reassignDisabled', { ns: 'chat' })) : reason
        }
      >
        <div
          style={{ ...baseTriggerStyle, cursor: 'not-allowed', opacity: 0.5 }}
          onClick={(event) => event.stopPropagation()}
        >
          <span style={blockedContentStyle}>{children}</span>
        </div>
      </Tooltip>
    ) : (
      <div style={baseTriggerStyle} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    );

    return (
      <Popover
        disabled={blocked}
        key={key}
        placement={'bottomLeft'}
        styles={{ content: { padding: 0, width: 320 } }}
        trigger={'click'}
        content={
          <Suspense fallback={<SkeletonList rows={6} />}>
            {isAgentListInit ? (
              <Flexbox onClick={(event) => event.stopPropagation()}>
                <input
                  autoFocus
                  {...stylex.props(styles.searchInput)}
                  placeholder={t('taskList.assigneeSearch.agentPlaceholder', { ns: 'chat' })}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                {rows.length === 0 ? (
                  <Flexbox align={'center'} justify={'center'} padding={16}>
                    <Text fontSize={12} type={'secondary'}>
                      {t('taskList.assigneeSearch.agentEmpty', { ns: 'chat' })}
                    </Text>
                  </Flexbox>
                ) : (
                  <Flexbox
                    gap={4}
                    padding={8}
                    ref={listRef}
                    style={{ maxHeight: '50vh', overflowY: 'auto', width: '100%' }}
                  >
                    {rows.map(renderRow)}
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
