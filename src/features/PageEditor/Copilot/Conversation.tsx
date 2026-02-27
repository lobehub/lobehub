import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useEffect, useMemo } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { actionMap } from '@/features/ChatInput/ActionBar/config';
import { ActionBarContext } from '@/features/ChatInput/ActionBar/context';
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

const COMPACT_ACTION_SIZE = { blockSize: 28, size: 16 };
const COMPACT_CONTEXT_VALUE = { actionSize: COMPACT_ACTION_SIZE };
const COMPACT_ACTION_BAR_STYLE = { paddingLeft: 4, paddingRight: 4 };
const COMPACT_SEND_BUTTON_PROPS = { size: 28 };

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

  const leftContent = useMemo(
    () => (
      <ActionBarContext value={COMPACT_CONTEXT_VALUE}>
        <Flexbox horizontal align={'center'} gap={2}>
          <AgentSelectorAction agentId={currentAgentId} onAgentChange={handleAgentChange} />
          <Search />
        </Flexbox>
      </ActionBarContext>
    ),
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
          actionBarStyle={COMPACT_ACTION_BAR_STYLE}
          allowExpand={false}
          leftActions={EMPTY_LEFT_ACTIONS}
          leftContent={leftContent}
          sendAreaPrefix={modelSelector}
          sendButtonProps={COMPACT_SEND_BUTTON_PROPS}
        />
      </Flexbox>
    </DragUploadZone>
  );
});

export default Conversation;
