import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useEffect, useMemo } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { actionMap } from '@/features/ChatInput/ActionBar/config';
import { ChatInput, ChatList } from '@/features/Conversation';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import AgentSelectorAction from './AgentSelector/AgentSelectorAction';
import CopilotModelSelector from './CopilotModelSelector';
import CopilotToolbar from './Toolbar';
import Welcome from './Welcome';

const Search = actionMap['search'];

const EMPTY_LEFT_ACTIONS: [] = [];

interface ConversationProps {
  agentId: string;
}

const Conversation = memo<ConversationProps>(({ agentId }) => {
  const [activeAgentId, setActiveAgentId, useFetchAgentConfig] = useAgentStore((s) => [
    s.activeAgentId,
    s.setActiveAgentId,
    s.useFetchAgentConfig,
  ]);

  useEffect(() => {
    setActiveAgentId(agentId);
    useChatStore.setState({ activeAgentId: agentId });
  }, [agentId, setActiveAgentId]);

  const currentAgentId = activeAgentId || agentId;

  useFetchAgentConfig(true, currentAgentId);

  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(currentAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(currentAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  const handleAgentChange = useCallback(
    (id: string) => {
      setActiveAgentId(id);
      useChatStore.setState({ activeAgentId: id });
    },
    [setActiveAgentId],
  );

  const copilotItems: ChatInputActionsProps['items'] = useMemo(
    () => [
      {
        alwaysDisplay: true,
        children: (
          <AgentSelectorAction agentId={currentAgentId} onAgentChange={handleAgentChange} />
        ),
        key: 'agent-selector',
      },
      { children: <Search />, key: 'search' },
    ],
    [currentAgentId, handleAgentChange],
  );

  const modelSelector = useMemo(
    () => <CopilotModelSelector agentId={currentAgentId} />,
    [currentAgentId],
  );

  return (
    <DragUploadZone
      style={{ flex: 1, height: '100%', minWidth: 300 }}
      onUploadFiles={handleUploadFiles}
    >
      <Flexbox flex={1} height={'100%'}>
        <CopilotToolbar agentId={currentAgentId} />
        <Flexbox flex={1} style={{ overflow: 'hidden' }}>
          <ChatList welcome={<Welcome />} />
        </Flexbox>
        <ChatInput
          allowExpand={false}
          extraActionItems={copilotItems}
          leftActions={EMPTY_LEFT_ACTIONS}
          sendAreaPrefix={modelSelector}
        />
      </Flexbox>
    </DragUploadZone>
  );
});

export default Conversation;
