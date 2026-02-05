import { ActionIcon, Block, Flexbox, Popover } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronsUpDownIcon, Clock3Icon, PanelRightCloseIcon, PlusIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/app/[variants]/(main)/home/_layout/Body/Agent/List/AgentItem/Avatar';
import { AgentModalProvider } from '@/app/[variants]/(main)/home/_layout/Body/Agent/ModalProvider';
import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import AgentItem from './AgentSelector/AgentItem';
import TopicItem from './TopicSelector/TopicItem';

const styles = createStaticStyles(({ css }) => ({
  fadeContainer: css`
    display: flex;
    gap: 0;
    align-items: center;
    transition: opacity 0.2s ease-in-out;
  `,
  fadeIn: css`
    opacity: 1;
  `,
  fadeOut: css`
    pointer-events: none;
    opacity: 0;
  `,
}));

interface AgentSelectorProps {
  agentId: string;
  onAgentChange: (id: string) => void;
}

const AgentSelector = memo<AgentSelectorProps>(({ agentId, onAgentChange }) => {
  const { t } = useTranslation(['chat', 'common']);
  const [open, setOpen] = useState(false);

  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const pageAgentId = useAgentStore((s) => s.builtinAgentIdMap['page-agent']);
  const pageAgentData = useAgentStore((s) => s.agentMap[pageAgentId || '']);

  useFetchAgentList();

  // Always include the Built-in Copilot (page agent) in the agent list
  const agentsWithBuiltin = useMemo(() => {
    // Check if page agent is already in the list
    const hasPageAgent = agents.some((agent) => agent.id === pageAgentId);

    // If page agent exists and is not in the list, add it at the beginning
    if (pageAgentId && !hasPageAgent) {
      return [
        {
          avatar: pageAgentData?.avatar || null,
          description: pageAgentData?.description || null,
          id: pageAgentId,
          pinned: false,
          title: t('builtinCopilot', { defaultValue: 'Built-in Copilot', ns: 'chat' }),
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
          onAgentChange={onAgentChange}
          onClose={() => setOpen(false)}
        />
      ))}
    </Flexbox>
  );

  return (
    <Popover
      open={open}
      placement="bottomLeft"
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
      <Block
        clickable
        horizontal
        align={'center'}
        gap={4}
        padding={2}
        variant={'borderless'}
        style={{
          minWidth: 32,
        }}
      >
        <AgentAvatar
          avatar={typeof activeAgent?.avatar === 'string' ? activeAgent.avatar : undefined}
        />
        <ActionIcon
          icon={ChevronsUpDownIcon}
          size={{
            blockSize: 28,
            size: 16,
          }}
          style={{
            width: 24,
          }}
        />
      </Block>
    </Popover>
  );
});

interface CopilotToolbarProps {
  agentId: string;
  isHovered: boolean;
}

const CopilotToolbar = memo<CopilotToolbarProps>(({ agentId, isHovered }) => {
  const { t } = useTranslation('topic');
  const setActiveAgentId = useAgentStore((s) => s.setActiveAgentId);
  const [topicPopoverOpen, setTopicPopoverOpen] = useState(false);

  const handleAgentChange = useCallback(
    (id: string) => {
      setActiveAgentId(id);
      // Sync chatStore's activeAgentId to ensure topic selectors work correctly
      useChatStore.setState({ activeAgentId: id });
    },
    [setActiveAgentId],
  );

  // Fetch topics for the agent builder
  useChatStore((s) => s.useFetchTopics)(true, { agentId });

  const [activeTopicId, switchTopic, topics] = useChatStore((s) => [
    s.activeTopicId,
    s.switchTopic,
    topicSelectors.currentTopics(s),
  ]);

  const [toggleRightPanel] = useGlobalStore((s) => [s.toggleRightPanel]);

  // topics === undefined means still loading, topics.length === 0 means confirmed empty
  const isLoadingTopics = topics === undefined;
  const hideHistory = !isLoadingTopics && topics.length === 0;

  return (
    <NavHeader
      showTogglePanelButton={false}
      left={
        <Flexbox horizontal align="center" gap={8}>
          <AgentSelector agentId={agentId} onAgentChange={handleAgentChange} />
        </Flexbox>
      }
      right={
        <>
          <div className={cx(styles.fadeContainer, isHovered ? styles.fadeIn : styles.fadeOut)}>
            <ActionIcon
              icon={PlusIcon}
              size={DESKTOP_HEADER_ICON_SIZE}
              title={t('actions.addNewTopic')}
              onClick={() => switchTopic(null, { scope: 'page' })}
            />
            {!hideHistory && (
              <Popover
                open={isLoadingTopics ? false : topicPopoverOpen}
                placement="bottomRight"
                trigger="click"
                content={
                  <Flexbox
                    gap={4}
                    padding={8}
                    style={{
                      maxHeight: '50vh',
                      overflowY: 'auto',
                      width: '100%',
                    }}
                  >
                    {(topics || []).map((topic) => (
                      <TopicItem
                        active={topic.id === activeTopicId}
                        key={topic.id}
                        topicId={topic.id}
                        topicTitle={topic.title}
                        onClose={() => setTopicPopoverOpen(false)}
                        onTopicChange={(id) => switchTopic(id)}
                      />
                    ))}
                  </Flexbox>
                }
                styles={{
                  content: {
                    padding: 0,
                    width: 240,
                  },
                }}
                onOpenChange={setTopicPopoverOpen}
              >
                <ActionIcon
                  disabled={isLoadingTopics}
                  icon={Clock3Icon}
                  loading={isLoadingTopics}
                  size={DESKTOP_HEADER_ICON_SIZE}
                />
              </Popover>
            )}
          </div>
          <ActionIcon
            icon={PanelRightCloseIcon}
            size={DESKTOP_HEADER_ICON_SIZE}
            onClick={() => toggleRightPanel()}
          />
        </>
      }
    />
  );
});

CopilotToolbar.displayName = 'TopicSelector';

export default CopilotToolbar;
