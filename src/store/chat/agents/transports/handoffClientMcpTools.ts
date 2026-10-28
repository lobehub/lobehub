import type { AgentInstruction, AgentRuntimeHost } from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { createWorkspaceLambdaClient } from '@/libs/trpc/client';
import type { ChatStore } from '@/store/chat/store';

/** Persist the original client batch before wire execution. Its agent loop stays on this host. */
export async function prepareClientMcpTools(
  host: AgentRuntimeHost,
  instruction: AgentInstruction,
  get: () => ChatStore,
): Promise<AgentInstruction> {
  if (instruction.type !== 'call_tool' && instruction.type !== 'call_tools_batch')
    return instruction;
  const tools: ChatToolPayload[] =
    instruction.type === 'call_tool'
      ? [instruction.payload.toolCalling]
      : instruction.payload.toolsCalling;
  if (!tools.some((tool) => tool.type === 'mcp')) return instruction;
  const operation = get().operations[host.operation.operationId];
  if (!operation) throw new Error('Client MCP operation is unavailable');
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
    ids[tool.id] =
      existingId ??
      (
        await host.transports.messages.createToolMessage({
          agentId: host.operation.agentId,
          groupId: host.operation.groupId,
          content: '',
          parentId: assistantId,
          plugin: tool,
          role: 'tool',
          threadId: host.operation.threadId,
          tool_call_id: tool.id,
          topicId: host.operation.topicId,
        })
      ).id;
  }
  const owner = crypto.randomUUID();
  const workspaceId = getActiveWorkspaceId() ?? undefined;
  const lambdaClient = createWorkspaceLambdaClient(workspaceId ?? null);
  const anchor = await lambdaClient.mcpElicitation.registerClientStep.mutate({
    assistantMessageId: assistantId,
    toolMessageIds: tools.map((tool) => ids[tool.id]),
    owner,
  });
  get().updateOperationMetadata(host.operation.operationId, {
    mcpClientStep: { ...anchor, owner, workspaceId, assistantMessageId: assistantId },
  });
  const heartbeat = setInterval(() => {
    void lambdaClient.mcpElicitation.leaseClientStep
      .mutate({ operationId: anchor.operationId, owner })
      .catch(console.error);
  }, 15_000);
  const stop = () => clearInterval(heartbeat);
  const abort = () => {
    stop();
    void lambdaClient.mcpElicitation.cancelClientStep
      .mutate({ operationId: anchor.operationId, owner })
      .catch(console.error);
  };
  operation.abortController.signal.addEventListener('abort', abort, { once: true });
  if (operation.abortController.signal.aborted) abort();
  get().registerAfterCompletionCallback(host.operation.operationId, async () => {
    stop();
    operation.abortController.signal.removeEventListener('abort', abort);
    await lambdaClient.mcpElicitation.leaseClientStep.mutate({
      operationId: anchor.operationId,
      owner,
      finish: true,
    });
  });
  if (instruction.type === 'call_tool')
    return {
      ...instruction,
      payload: {
        ...instruction.payload,
        parentMessageId: ids[tools[0].id],
        skipCreateToolMessage: true,
      },
    };
  return { ...instruction, payload: { ...instruction.payload, existingToolMessageIds: ids } };
}
