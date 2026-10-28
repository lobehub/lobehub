import type {
  AgentInstruction,
  AgentRuntimeHost,
  AgentState,
  InstructionExecutionResult,
} from '@lobechat/agent-runtime';
import type { ChatToolPayload, MessageMetadata } from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';

/** Promote an approved client tool batch into the existing durable approval continuation.
 * The client has no durable operation. Persist its exact tool rows before the server claims
 * them; after that claim the server owns execution, elicitation and parent continuation.
 */
export async function handoffClientMcpTools(
  host: AgentRuntimeHost,
  instruction: AgentInstruction,
  state: AgentState,
  get: () => ChatStore,
  metadata?: Pick<MessageMetadata, 'trigger'>,
): Promise<InstructionExecutionResult | undefined> {
  if (instruction.type !== 'call_tool' && instruction.type !== 'call_tools_batch') return;
  const tools: ChatToolPayload[] =
    instruction.type === 'call_tool'
      ? [instruction.payload.toolCalling]
      : instruction.payload.toolsCalling;
  if (!tools.some((tool) => tool.type === 'mcp')) return;
  const operation = get().operations[host.operation.operationId];
  const agentId = host.operation.agentId ?? operation?.context.agentId;
  if (!operation || !agentId) throw new Error('Client MCP operation is unavailable');
  const parent = await host.transports.messages.findById(instruction.payload.parentMessageId);
  const assistantId = parent?.role === 'assistant' ? parent.id : parent?.parentId;
  if (!assistantId) throw new Error('Client MCP assistant identity is unavailable');
  const ids: Record<string, string> = {};
  for (const tool of tools) {
    const existingId =
      instruction.type === 'call_tool'
        ? instruction.payload.skipCreateToolMessage
          ? instruction.payload.parentMessageId
          : undefined
        : instruction.payload.existingToolMessageIds?.[tool.id];
    if (existingId) {
      await host.transports.messages.updateToolIntervention(existingId, { status: 'pending' });
      ids[tool.id] = existingId;
    } else {
      ids[tool.id] = (
        await host.transports.messages.createToolMessage({
          agentId: host.operation.agentId,
          groupId: host.operation.groupId,
          content: '',
          parentId: assistantId,
          plugin: tool,
          pluginIntervention: { status: 'pending' },
          role: 'tool',
          threadId: host.operation.threadId,
          tool_call_id: tool.id,
          topicId: host.operation.topicId,
        })
      ).id;
    }
  }
  const result = await get().executeGatewayAgent({
    context: { ...operation.context, agentId },
    message: '',
    metadata,
    parentMessageId: ids[tools[0].id],
    parentOperationId: host.operation.operationId,
    resumeApprovals: tools.map((tool) => ({
      decision: 'approved',
      parentMessageId: ids[tool.id],
      toolCallId: tool.id,
    })),
  });
  if (!result.success)
    throw new Error(result.error || 'Could not persist the MCP tool continuation');
  // The durable replacement owns subsequent LLM steps. Park the local loop exactly like
  // existing client approval continuations; never feed a deferred object to the model.
  return {
    events: [],
    newState: {
      ...state,
      status: 'waiting_for_human',
      pendingToolsCalling: undefined,
      pendingToolMessageIds: undefined,
    },
  };
}
