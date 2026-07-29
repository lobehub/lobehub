import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { Flexbox, Popover, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type SidebarAgentItem } from '@/database/repositories/home';
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
  onChange?: (agentId: string) => void;
  taskIdentifier?: string;
}

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

const triggerStyle: CSSProperties = {
  alignItems: 'center',
  display: 'inline-flex',
  justifyContent: 'center',
  lineHeight: 1,
};

const AssigneeAgentSelector = memo<AssigneeAgentSelectorProps>(
  ({ children, currentAgentId, disabled, onChange, taskIdentifier }) => {
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
            title: inboxMeta?.title || t('inbox.title', { ns: 'chat' }),
            type: 'agent' as const,
            updatedAt: new Date(),
          },
          ...available,
        ];
      }

      return available;
    }, [pinnedAgents, agentGroups, ungroupedAgents, inboxAgentId, inboxMeta, t]);

    const privateAgents = useMemo<SidebarAgentItem[]>(() => {
      const groupedItems = privateAgentGroups.flatMap((group) => group.items);
      return [...privatePinnedAgents, ...groupedItems, ...privateUngroupedAgents].filter(
        (agent) => agent.type === 'agent',
      );
    }, [privateAgentGroups, privatePinnedAgents, privateUngroupedAgents]);

    const filteredPrivate = useMemo(() => {
      const q = search.trim().toLowerCase();
      if (!q) return privateAgents;
      return privateAgents.filter((agent) => (agent.title || '').toLowerCase().includes(q));
    }, [privateAgents, search]);

    const filteredWorkspace = useMemo(() => {
      const q = search.trim().toLowerCase();
      if (!q) return workspaceAgents;
      return workspaceAgents.filter((agent) => (agent.title || '').toLowerCase().includes(q));
    }, [workspaceAgents, search]);

    // Flat order for keyboard navigation and activeIndex: private first, then workspace.
    // In personal / no-private mode, only the workspace list contributes.
    const filteredFlat = useMemo(
      () => (hasPrivateAgents ? [...filteredPrivate, ...filteredWorkspace] : filteredWorkspace),
      [hasPrivateAgents, filteredPrivate, filteredWorkspace],
    );

    useEffect(() => {
      if (search.trim()) {
        setActiveIndex(0);
        return;
      }
      const selectedIdx = filteredFlat.findIndex((a) => a.id === currentAgentId);
      setActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
    }, [search, filteredFlat, currentAgentId]);

    const handleAgentChange = useCallback(
      (agentId: string) => {
        if (!canEditTask) return;
        if (agentId === currentAgentId) return;
        setKey((k) => k + 1);
        setSearch('');
        if (onChange) {
          onChange(agentId);
          return;
        }
        if (taskIdentifier) {
          void updateTask(taskIdentifier, { assigneeAgentId: agentId });
        }
      },
      [canEditTask, currentAgentId, onChange, taskIdentifier, updateTask],
    );

    const handleSearchKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        if (filteredFlat.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % filteredFlat.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + filteredFlat.length) % filteredFlat.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const target = filteredFlat[activeIndex];
          if (target) handleAgentChange(target.id);
        }
      },
      [activeIndex, filteredFlat, handleAgentChange],
    );

    useEffect(() => {
      const list = listRef.current;
      if (!list) return;
      const active = list.querySelector<HTMLElement>(`[data-agent-index="${activeIndex}"]`);
      active?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const renderItems = (list: SidebarAgentItem[], offset: number) =>
      list.map((agent, i) => {
        const flatIndex = offset + i;
        return (
          <div
            data-agent-index={flatIndex}
            key={agent.id}
            onMouseEnter={() => setActiveIndex(flatIndex)}
          >
            <AgentItem
              active={flatIndex === activeIndex}
              agentId={agent.id}
              agentTitle={agent.title || t('untitledAgent', { ns: 'chat' })}
              avatar={agent.avatar}
              heterogeneousType={agent.heterogeneousType}
              onAgentChange={handleAgentChange}
              onClose={() => setKey((k) => k + 1)}
            />
          </div>
        );
      });

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
                {filteredFlat.length === 0 ? (
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
                    {hasPrivateAgents ? (
                      <>
                        {filteredPrivate.length > 0 && (
                          <>
                            <div className={styles.sectionHeader}>
                              {t('taskManager.agentSelector.privateGroup', { ns: 'topic' })}
                            </div>
                            {renderItems(filteredPrivate, 0)}
                          </>
                        )}
                        {filteredWorkspace.length > 0 && (
                          <>
                            <div className={styles.sectionHeader}>
                              {t('taskManager.agentSelector.workspaceGroup', { ns: 'topic' })}
                            </div>
                            {renderItems(filteredWorkspace, filteredPrivate.length)}
                          </>
                        )}
                      </>
                    ) : (
                      renderItems(filteredFlat, 0)
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
