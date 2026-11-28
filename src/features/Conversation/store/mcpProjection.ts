import { createReplica } from 'local-replica/react';

import { defineReplica, replicaSWRDriver } from '@/libs/replica';
import { mcpElicitationService, type PendingMcpElicitation } from '@/services/mcpElicitation';

interface ConversationInput {
  scope: string;
  threadId?: string | null;
  topicId: string;
}

type StepInput = ConversationInput & { revision: string };
type SavedSteps = Awaited<ReturnType<typeof mcpElicitationService.clientSteps>>;

const conversationKey = ({ scope, topicId, threadId }: ConversationInput) =>
  JSON.stringify([scope, topicId, threadId ?? null]);

export const pendingMcpInputs = createReplica<ConversationInput, PendingMcpElicitation[]>(
  defineReplica<ConversationInput, PendingMcpElicitation[]>({
    fetcher: ({ topicId, threadId }) => mcpElicitationService.pending(topicId, threadId),
    key: conversationKey,
    name: 'conversation-pending-mcp-inputs',
    storage: 'memory',
    version: 1,
  }),
  { driver: replicaSWRDriver },
);

export const savedMcpSteps = createReplica<StepInput, SavedSteps>(
  defineReplica<StepInput, SavedSteps>({
    fetcher: (input) => mcpElicitationService.clientSteps(input),
    key: conversationKey,
    name: 'conversation-mcp-steps',
    query: ({ revision }) => ({ revision }),
    storage: 'memory',
    version: 1,
  }),
  { driver: replicaSWRDriver },
);

export const revalidatePendingMcpInputs = (input: ConversationInput) =>
  pendingMcpInputs.revalidate(conversationKey(input));
