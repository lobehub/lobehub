import { Center, Flexbox, Popover } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronsUpDownIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/app/[variants]/(main)/home/_layout/Body/Agent/List/AgentItem/Avatar';
import { AgentModalProvider } from '@/app/[variants]/(main)/home/_layout/Body/Agent/ModalProvider';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import AgentItem from './AgentItem';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  container: css`
    cursor: pointer;

    border-radius: 12px;
    border-start-start-radius: 8px;
    border-end-start-radius: 8px;

    background: ${cssVar.colorFillTertiary};

    :hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

interface AgentSelectorActionProps {
  agentId: string;
  onAgentChange: (id: string) => void;
}

const AgentSelectorAction = memo<AgentSelectorActionProps>(({ agentId, onAgentChange }) => {
  const { t } = useTranslation(['chat', 'common']);
  const [open, setOpen] = useState(false);

  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const pageAgentId = useAgentStore((s) => s.builtinAgentIdMap['page-agent']);
  const pageAgentData = useAgentStore((s) => s.agentMap[pageAgentId || '']);

  useFetchAgentList();

  const agentsWithBuiltin = useMemo(() => {
    const hasPageAgent = agents.some((agent) => agent.id === pageAgentId);

    if (pageAgentId && !hasPageAgent) {
      return [
        {
          avatar: pageAgentData?.avatar || null,
          description: pageAgentData?.description || null,
          id: pageAgentId,
          pinned: false,
          title: t('builtinCopilot'),
          type: 'agent' as const,
          updatedAt: new Date(),
        },
        ...agents,
      ];
    }

    return agents;
  }, [agents, pageAgentId, pageAgentData, t]);

  const activeAgent = useMemo(
    () => agentsWithBuiltin.find((agent) => agent.id === agentId),
    [agentId, agentsWithBuiltin],
  );

  const handleAgentChange = useCallback(
    (id: string) => {
      onAgentChange(id);
    },
    [onAgentChange],
  );

  const renderAgents = (
    <Flexbox
      gap={4}
      padding={8}
      style={{
        maxHeight: '50vh',
        overflowY: 'auto',
        width: '100%',
      }}
    >
      {agentsWithBuiltin.map((agent) => (
        <AgentItem
          active={agent.id === agentId}
          agentId={agent.id}
          agentTitle={agent.title || t('untitledAgent', { ns: 'chat' })}
          avatar={agent.avatar}
          key={agent.id}
          onAgentChange={handleAgentChange}
          onClose={() => setOpen(false)}
        />
      ))}
    </Flexbox>
  );

  return (
    <Popover
      open={open}
      placement="topLeft"
      trigger="click"
      content={
        <Suspense fallback={<SkeletonList rows={6} />}>
          <AgentModalProvider>
            {isAgentListInit ? renderAgents : <SkeletonList rows={6} />}
          </AgentModalProvider>
        </Suspense>
      }
      styles={{
        content: {
          padding: 0,
          width: 240,
        },
      }}
      onOpenChange={setOpen}
    >
      <Center horizontal className={cx(styles.container)} height={28} paddingInline={6}>
        <Flexbox horizontal align={'center'} gap={4}>
          <AgentAvatar
            avatar={typeof activeAgent?.avatar === 'string' ? activeAgent.avatar : undefined}
          />
          <ChevronsUpDownIcon className={styles.chevron} size={14} />
        </Flexbox>
      </Center>
    </Popover>
  );
});

AgentSelectorAction.displayName = 'AgentSelectorAction';

export default AgentSelectorAction;
