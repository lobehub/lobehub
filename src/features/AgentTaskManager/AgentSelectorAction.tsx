import { Center, Flexbox, Popover } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ChevronsUpDownIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type SidebarAgentItem } from '@/database/repositories/home';
import { conversationSelectors, useConversationStore } from '@/features/Conversation';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import AgentItem from '@/features/PageEditor/Copilot/AgentSelector/AgentItem';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import AgentAvatar from '@/routes/(main)/home/_layout/Body/Agent/List/AgentItem/Avatar';
import { AgentModalProvider } from '@/routes/(main)/home/_layout/Body/Agent/ModalProvider';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

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
  sectionHeader: css`
    padding-block: 4px;
    padding-inline: 8px;

    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface AgentSelectorActionProps {
  onAgentChange: (id: string) => void;
}

const AgentSelectorAction = memo<AgentSelectorActionProps>(({ onAgentChange }) => {
  const { t } = useTranslation(['chat', 'topic']);
  const [open, setOpen] = useState(false);
  const agentId = useConversationStore(conversationSelectors.agentId);

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
  const taskAgentId = useAgentStore(builtinAgentSelectors.taskAgentId);
  const taskAgentData = useAgentStore((s) => s.agentMap[taskAgentId || '']);

  useFetchAgentList();

  // Workspace bucket: pinned + grouped + ungrouped. In personal mode this is the entire
  // list (private buckets are empty). The builtin task agent is shared content, so it
  // is injected at the top of this bucket when missing — keeping the prior behavior.
  const workspaceAgents = useMemo<SidebarAgentItem[]>(() => {
    const groupedItems = agentGroups.flatMap((group) => group.items);
    const merged = [...pinnedAgents, ...groupedItems, ...ungroupedAgents].filter(
      (agent) => agent.type === 'agent',
    );

    if (taskAgentId && !merged.some((agent) => agent.id === taskAgentId)) {
      return [
        {
          avatar: taskAgentData?.avatar || null,
          description: taskAgentData?.description || null,
          id: taskAgentId,
          pinned: false,
          title: t('taskManager.agent', { ns: 'topic' }),
          type: 'agent' as const,
          updatedAt: new Date(),
        },
        ...merged,
      ];
    }

    return merged;
  }, [pinnedAgents, agentGroups, ungroupedAgents, taskAgentId, taskAgentData, t]);

  const privateAgents = useMemo<SidebarAgentItem[]>(() => {
    const groupedItems = privateAgentGroups.flatMap((group) => group.items);
    return [...privatePinnedAgents, ...groupedItems, ...privateUngroupedAgents].filter(
      (agent) => agent.type === 'agent',
    );
  }, [privateAgentGroups, privatePinnedAgents, privateUngroupedAgents]);

  const activeAgent = useMemo(
    () => [...privateAgents, ...workspaceAgents].find((agent) => agent.id === agentId),
    [agentId, privateAgents, workspaceAgents],
  );

  const handleAgentChange = useCallback(
    (id: string) => {
      onAgentChange(id);
    },
    [onAgentChange],
  );

  const renderAgentItems = (list: SidebarAgentItem[]) =>
    list.map((agent) => (
      <AgentItem
        active={agent.id === agentId}
        agentId={agent.id}
        agentTitle={agent.title || t('untitledAgent', { ns: 'chat' })}
        avatar={agent.avatar}
        key={agent.id}
        onAgentChange={handleAgentChange}
        onClose={() => setOpen(false)}
      />
    ));

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
      {hasPrivateAgents ? (
        <>
          {privateAgents.length > 0 && (
            <>
              <div className={styles.sectionHeader}>
                {t('taskManager.agentSelector.privateGroup', { ns: 'topic' })}
              </div>
              {renderAgentItems(privateAgents)}
            </>
          )}
          {workspaceAgents.length > 0 && (
            <>
              <div className={styles.sectionHeader}>
                {t('taskManager.agentSelector.workspaceGroup', { ns: 'topic' })}
              </div>
              {renderAgentItems(workspaceAgents)}
            </>
          )}
        </>
      ) : (
        renderAgentItems(workspaceAgents)
      )}
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
