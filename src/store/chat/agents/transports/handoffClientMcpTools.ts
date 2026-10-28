import type { AgentInstruction, AgentRuntimeHost } from '@lobechat/agent-runtime';
import { isDesktop } from '@lobechat/const';
import type { ChatToolPayload } from '@lobechat/types';
import { toRecord } from '@lobechat/utils/object';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { createWorkspaceLambdaClient } from '@/libs/trpc/client';
import type { ChatStore } from '@/store/chat/store';
import { pluginSelectors } from '@/store/tool/selectors';
import { getToolStoreState } from '@/store/tool/store';
import { ensureElectronIpc } from '@/utils/electron/ipc';

/** Persist the original client batch before wire execution. Its agent loop stays on this host. */
export async function prepareClientMcpTools(
  host: AgentRuntimeHost,
  instruction: AgentInstruction,
  get: () => ChatStore,
  toolResultMaxLength?: number,
): Promise<AgentInstruction> {
  if (instruction.type !== 'call_tool' && instruction.type !== 'call_tools_batch')
    return instruction;
  const tools: ChatToolPayload[] =
    instruction.type === 'call_tool'
      ? [instruction.payload.toolCalling]
      : instruction.payload.toolsCalling;
  if (!tools.some((tool) => tool.type === 'mcp')) return instruction;
  const toolStore = getToolStoreState();
  const managedTools = tools.filter((tool) => {
    if (tool.type !== 'mcp') return false;
    // Connector-first dispatch has priority over an installed plugin with the same identifier.
    if (toolStore.connectors?.some((connector) => connector.identifier === tool.identifier))
      return true;
    const plugin =
      pluginSelectors.getInstalledPluginById(tool.identifier)(toolStore) ??
      pluginSelectors.getCustomPluginById(tool.identifier)(toolStore);
    return plugin?.customParams?.mcp?.type !== 'cloud';
  });
  if (!managedTools.length) return instruction;
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
    toolMessageIds: managedTools.map((tool) => ids[tool.id]),
    localHostTimeoutMs: isDesktop ? await ensureElectronIpc().mcp.getToolTimeoutMs() : undefined,
    owner,
    toolResultMaxLength,
  });
  for (const tool of managedTools) {
    const id = ids[tool.id];
    await host.transports.messages.updatePluginState(id, {
      mcpInvocationDeadline: anchor.deadlines?.[id] ?? anchor.deadline,
    });
  }
  const binding = { ...anchor, owner, workspaceId, assistantMessageId: assistantId };
  get().updateOperationMetadata(host.operation.operationId, {
    mcpClientStep: binding,
    // Approval may prepare another subset while an earlier tool is still running.
    // Bind each row to its own anchor instead of using the last prepared subset.
    mcpClientSteps: {
      ...toRecord(get().operations[host.operation.operationId]?.metadata?.mcpClientSteps),
      ...Object.fromEntries(managedTools.map((tool) => [ids[tool.id], binding])),
    },
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
