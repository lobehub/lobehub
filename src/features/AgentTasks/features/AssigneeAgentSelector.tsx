import { agentDisplayName } from '@lobechat/types';
import {
  confirmModal,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  Popover,
  Text,
  Tooltip,
} from '@lobehub/ui';
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
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { useTaskStore } from '@/store/task';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import {
  filterAssigneeSections,
  matchesAssigneeSearch,
  pickRecentAssignees,
  shouldOfferPrivateAgents,
} from './assigneeAgentSections';
import { useAssigneeAgentScopes } from './useAssigneeAgentScopes';

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

const RECENT_SECTION_ID = 'recent';

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

    /* The global focus ring would box the whole popover top; the divider takes its place. */
    &:focus-visible {
      border-block-end-color: ${cssVar.colorPrimary};
    }

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
  sectionToggle: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;

    width: 100%;
    padding-block: 4px;
    padding-inline: 4px 8px;
    border: none;
    border-radius: ${cssVar.borderRadiusSM};

    font-family: inherit;
    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextTertiary};
    text-align: start;

    background: transparent;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  sectionToggleTitle: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

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
    const collapsedGroups = useGlobalStore((s) => s.status.assigneeAgentSelectorCollapsedGroups);
    const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
    const workspaceId = useActiveWorkspaceId();

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

    const { inboxAgent, isAgentListInit, privateAgentIds, recentIds, rememberAssignee, scopes } =
      useAssigneeAgentScopes({
        offerPrivate: offerPrivateAgents,
        privateTitle: takesOver
          ? t('taskManager.agentSelector.privateGroupTakesOver', { ns: 'topic' })
          : offerPrivateOnPublic
            ? t('taskManager.agentSelector.privateGroupMakesPrivate', { ns: 'topic' })
            : t('taskManager.agentSelector.privateGroup', { ns: 'topic' }),
      });

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

    const assignAgent = useCallback(
      (agentId: string | null, agent?: SidebarAgentItem) => {
        if (agentId) rememberAssignee(agentId);
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
      [onChange, rememberAssignee, taskIdentifier, updateTask],
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
          <div className={styles.sectionHeader} key={`scope:${row.key}`}>
            {row.title}
          </div>
        );
      if (!row.collapsible)
        return (
          <div className={styles.sectionHeader} key={`section:${row.id}`}>
            {row.title}
          </div>
        );
      return (
        <button
          aria-expanded={!row.collapsed}
          className={styles.sectionToggle}
          key={`section:${row.id}`}
          type={'button'}
          onClick={() => toggleSection(row.id, row.collapsed)}
          // Keep focus in the search box so the arrow keys still move the list.
          onMouseDown={(event) => event.preventDefault()}
        >
          <Icon icon={row.collapsed ? ChevronRight : ChevronDown} size={14} />
          <span className={styles.sectionToggleTitle}>{row.title}</span>
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
                  className={styles.searchInput}
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
