import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { UserRoundX } from 'lucide-react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

interface AssigneeAgentSelectorProps {
  children: ReactNode;
  currentAgentId?: string | null;
  disabled?: boolean;
  onChange?: (agentId: string | null) => void;
  taskIdentifier?: string;
  taskVisibility?: 'private' | 'public' | null;
}

type AgentOption =
  | { key: 'unassigned'; kind: 'unassigned' }
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

const matchesSearch = (agent: SidebarAgentItem, query: string) =>
  [agentDisplayName(agent), agent.title].some((label) =>
    (label ?? '').toLowerCase().includes(query),
  );

const triggerStyle: CSSProperties = {
  alignItems: 'center',
  display: 'inline-flex',
  justifyContent: 'center',
  lineHeight: 1,
  maxWidth: '100%',
  minWidth: 0,
};

const AssigneeAgentSelector = memo<AssigneeAgentSelectorProps>(
  ({ children, currentAgentId, disabled, onChange, taskIdentifier, taskVisibility }) => {
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

    const privateAgents = useMemo<SidebarAgentItem[]>(() => {
      if (taskVisibility === 'public') return [];
      const groupedItems = privateAgentGroups.flatMap((group) => group.items);
      return [...privatePinnedAgents, ...groupedItems, ...privateUngroupedAgents].filter(
        (agent) => agent.type === 'agent',
      );
    }, [privateAgentGroups, privatePinnedAgents, privateUngroupedAgents, taskVisibility]);

    const query = search.trim().toLowerCase();
    const filteredPrivate = useMemo(
      () => (query ? privateAgents.filter((agent) => matchesSearch(agent, query)) : privateAgents),
      [privateAgents, query],
    );
    const filteredWorkspace = useMemo(
      () =>
        query ? workspaceAgents.filter((agent) => matchesSearch(agent, query)) : workspaceAgents,
      [workspaceAgents, query],
    );

    const unassignedLabel = t('taskList.unassigned', { ns: 'chat' });
    const showUnassigned = !query || unassignedLabel.toLowerCase().includes(query);
    const flatOptions = useMemo<AgentOption[]>(
      () => [
        ...(showUnassigned ? [{ key: 'unassigned', kind: 'unassigned' } as const] : []),
        ...filteredPrivate.map(
          (agent) => ({ agent, key: `agent:${agent.id}`, kind: 'agent' }) as const,
        ),
        ...filteredWorkspace.map(
          (agent) => ({ agent, key: `agent:${agent.id}`, kind: 'agent' }) as const,
        ),
      ],
      [filteredPrivate, filteredWorkspace, showUnassigned],
    );
    const selectedKey = currentAgentId ? `agent:${currentAgentId}` : 'unassigned';

    useEffect(() => {
      if (query) {
        setActiveIndex(0);
        return;
      }
      const selectedIndex = flatOptions.findIndex((option) => option.key === selectedKey);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }, [flatOptions, query, selectedKey]);

    const handleAgentChange = useCallback(
      (agentId: string | null) => {
        if (!canEditTask || agentId === (currentAgentId ?? null)) return;
        setKey((value) => value + 1);
        setSearch('');
        if (onChange) {
          onChange(agentId);
          return;
        }
        if (taskIdentifier) void updateTask(taskIdentifier, { assigneeAgentId: agentId });
      },
      [canEditTask, currentAgentId, onChange, taskIdentifier, updateTask],
    );

    const handleSelect = useCallback(
      (option: AgentOption) => handleAgentChange(option.kind === 'agent' ? option.agent.id : null),
      [handleAgentChange],
    );

    const handleSearchKeyDown = useCallback(
      (event: KeyboardEvent<HTMLInputElement>) => {
        if (flatOptions.length === 0) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveIndex((index) => (index + 1) % flatOptions.length);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex((index) => (index - 1 + flatOptions.length) % flatOptions.length);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          const target = flatOptions[activeIndex];
          if (target) handleSelect(target);
        }
      },
      [activeIndex, flatOptions, handleSelect],
    );

    useEffect(() => {
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
      return (
        <div
          data-assignee-index={optionIndex}
          key={option.key}
          onMouseEnter={() => setActiveIndex(optionIndex)}
        >
          {option.kind === 'agent' ? (
            <AgentItem
              active={active}
              agent={option.agent}
              agentId={option.agent.id}
              agentTitle={agentDisplayName(option.agent, t('untitledAgent', { ns: 'chat' }))}
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

    const blocked = disabled || !canEditTask;
    const trigger = blocked ? (
      <Tooltip title={disabled ? t('taskDetail.reassignDisabled', { ns: 'chat' }) : reason}>
        <div
          style={{ ...triggerStyle, cursor: 'not-allowed', opacity: 0.5 }}
          onClick={(event) => event.stopPropagation()}
        >
          <span style={{ pointerEvents: 'none' }}>{children}</span>
        </div>
      </Tooltip>
    ) : (
      <div style={triggerStyle} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    );

    return (
      <Popover
        disabled={blocked}
        key={key}
        placement={'bottomLeft'}
        styles={{ content: { padding: 0, width: 260 } }}
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
                {flatOptions.length === 0 ? (
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
                    {showUnassigned && renderOption({ key: 'unassigned', kind: 'unassigned' })}
                    {filteredPrivate.length > 0 && (
                      <>
                        <div className={styles.sectionHeader}>
                          {t('taskManager.agentSelector.privateGroup', { ns: 'topic' })}
                        </div>
                        {filteredPrivate.map((agent) =>
                          renderOption({ agent, key: `agent:${agent.id}`, kind: 'agent' }),
                        )}
                      </>
                    )}
                    {filteredWorkspace.length > 0 && (
                      <>
                        {hasPrivateAgents && (
                          <div className={styles.sectionHeader}>
                            {t('taskManager.agentSelector.workspaceGroup', { ns: 'topic' })}
                          </div>
                        )}
                        {filteredWorkspace.map((agent) =>
                          renderOption({ agent, key: `agent:${agent.id}`, kind: 'agent' }),
                        )}
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
