import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { Flexbox, Popover, Tooltip } from '@lobehub/ui';
import { memo, type ReactNode, Suspense, useCallback, useMemo, useState } from 'react';
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

const AssigneeAgentSelector = memo<AssigneeAgentSelectorProps>(
  ({ children, currentAgentId, disabled, onChange, taskIdentifier }) => {
    const { t } = useTranslation(['chat', 'common']);
    const [key, setKey] = useState(0);

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

    const handleAgentChange = useCallback(
      (agentId: string) => {
        if (agentId === currentAgentId) return;
        setKey((k) => k + 1);
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
        styles={{ content: { padding: 0, width: 240 } }}
        trigger="click"
        content={
          <Suspense fallback={<SkeletonList rows={6} />}>
            {isAgentListInit ? (
              <Flexbox
                gap={4}
                padding={8}
                style={{ maxHeight: '50vh', overflowY: 'auto', width: '100%' }}
                onClick={(e) => e.stopPropagation()}
              >
                {agentList.map((agent) => (
                  <AgentItem
                    active={agent.id === currentAgentId}
                    agentId={agent.id}
                    agentTitle={agent.title || t('untitledAgent', { ns: 'chat' })}
                    avatar={agent.avatar}
                    key={agent.id}
                    onAgentChange={handleAgentChange}
                    onClose={() => setKey((k) => k + 1)}
                  />
                ))}
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
