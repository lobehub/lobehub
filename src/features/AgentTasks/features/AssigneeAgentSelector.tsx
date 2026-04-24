import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { Flexbox, Popover, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import {
  type KeyboardEvent,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import AgentItem from '@/features/PageEditor/Copilot/AgentSelector/AgentItem';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
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
}));

const AssigneeAgentSelector = memo<AssigneeAgentSelectorProps>(
  ({ children, currentAgentId, disabled, onChange, taskIdentifier }) => {
    const { t } = useTranslation(['chat', 'common']);
    const [key, setKey] = useState(0);
    const [search, setSearch] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const updateTask = useTaskStore((s) => s.updateTask);
    const agents = useHomeStore(homeAgentListSelectors.allAgents);
    const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);

    const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
    const inboxMeta = useAgentStore((s) =>
      inboxAgentId ? agentSelectors.getAgentMetaById(inboxAgentId)(s) : undefined,
    );

    useFetchAgentList();

    const agentList = useMemo(() => {
      const available = agents.filter((a) => a.type === 'agent');
      const hasInbox = available.some((a) => a.id === inboxAgentId);

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
    }, [agents, inboxAgentId, inboxMeta, t]);

    const filteredAgents = useMemo(() => {
      const q = search.trim().toLowerCase();
      if (!q) return agentList;
      return agentList.filter((a) => (a.title || '').toLowerCase().includes(q));
    }, [agentList, search]);

    useEffect(() => {
      if (search.trim()) {
        setActiveIndex(0);
        return;
      }
      const selectedIdx = filteredAgents.findIndex((a) => a.id === currentAgentId);
      setActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
    }, [search, filteredAgents, currentAgentId]);

    const handleAgentChange = useCallback(
      (agentId: string) => {
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
      [currentAgentId, onChange, taskIdentifier, updateTask],
    );

    const handleSearchKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        if (filteredAgents.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % filteredAgents.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + filteredAgents.length) % filteredAgents.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const target = filteredAgents[activeIndex];
          if (target) handleAgentChange(target.id);
        }
      },
      [activeIndex, filteredAgents, handleAgentChange],
    );

    useEffect(() => {
      const list = listRef.current;
      if (!list) return;
      const active = list.querySelector<HTMLElement>(`[data-agent-index="${activeIndex}"]`);
      active?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const trigger = disabled ? (
      <Tooltip title={t('taskDetail.reassignDisabled', { ns: 'chat' })}>
        <div style={{ cursor: 'not-allowed', opacity: 0.5 }} onClick={(e) => e.stopPropagation()}>
          <span style={{ pointerEvents: 'none' }}>{children}</span>
        </div>
      </Tooltip>
    ) : (
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    );

    return (
      <Popover
        disabled={disabled}
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
                {filteredAgents.length === 0 ? (
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
                    {filteredAgents.map((agent, index) => (
                      <div
                        data-agent-index={index}
                        key={agent.id}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <AgentItem
                          active={index === activeIndex}
                          agentId={agent.id}
                          agentTitle={agent.title || t('untitledAgent', { ns: 'chat' })}
                          avatar={agent.avatar}
                          onAgentChange={handleAgentChange}
                          onClose={() => setKey((k) => k + 1)}
                        />
                      </div>
                    ))}
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
