import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { flattenActions } from '@/store/utils/flattenActions';

import { type ConversationControlAction } from './entries/conversationControl';
import { ConversationControlActionImpl } from './entries/conversationControl';
import { type ConversationLifecycleAction } from './entries/conversationLifecycle';
import { ConversationLifecycleActionImpl } from './entries/conversationLifecycle';
import { type ChatMemoryAction } from './state/memory';
import { ChatMemoryActionImpl } from './state/memory';
import { type StreamingStatesAction } from './state/streamingStates';
import { StreamingStatesActionImpl } from './state/streamingStates';
import { type ClientToolExecutionAction } from './transports/client/clientToolExecution';
import { ClientToolExecutionActionImpl } from './transports/client/clientToolExecution';
import { type StreamingExecutorAction } from './transports/client/streamingExecutor';
import { StreamingExecutorActionImpl } from './transports/client/streamingExecutor';
import { type GatewayAction } from './transports/gateway/gateway';
import { GatewayActionImpl } from './transports/gateway/gateway';

export type ChatAgentRunAction = ChatMemoryAction &
  ClientToolExecutionAction &
  ConversationLifecycleAction &
  ConversationControlAction &
  GatewayAction &
  StreamingExecutorAction &
  StreamingStatesAction;

export const chatAgentRun: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatAgentRunAction
> = (
  ...params: Parameters<
    StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatAgentRunAction>
  >
) =>
  flattenActions<ChatAgentRunAction>([
    new ChatMemoryActionImpl(...params),
    new ClientToolExecutionActionImpl(...params),
    new ConversationLifecycleActionImpl(...params),
    new ConversationControlActionImpl(...params),
    new GatewayActionImpl(...params),
    new StreamingExecutorActionImpl(...params),
    new StreamingStatesActionImpl(...params),
  ]);
