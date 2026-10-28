import type { AgentRuntimeService } from '@/server/services/agentRuntime';

import type { McpElicitationService } from './McpElicitationService';

/** Durable deadline callback. Old rounds cannot expire a newer request on the same tool. */
export async function expireMcpElicitation(
  service: McpElicitationService,
  itemId: string,
  runtime: Pick<AgentRuntimeService, 'controlCompletedToolResult' | 'tryResumeParentFromAsyncTool'>,
) {
  const item = await service.get(itemId);
  if (
    !item.toolMessageId ||
    item.deadline.getTime() > Date.now() ||
    !['timed_out', 'session_ended', 'pending', 'resolving'].includes(item.status)
  )
    return;
  const plugin = await service.messages.findMessagePlugin(item.toolMessageId);
  const stored = plugin?.state?.mcpElicitation as { batchId?: string } | undefined;
  if (!stored || stored.batchId !== item.batchId) return;
  const operation = await service.operations.findById(item.operationId);
  if (!operation || ['done', 'error', 'interrupted', 'abandoned'].includes(operation.status)) {
    await service.interventions.markBatchTerminal(item.operationId, item.batchId, 'session_ended');
    await service.messages.updateMessagePlugin(item.toolMessageId, {
      intervention: { batchId: item.batchId, operationId: item.operationId, status: 'none' },
    });
    return;
  }
  const { identity, pending } = await service.loadContinuation(item.toolMessageId);
  if (pending.batchId !== item.batchId) return;
  await service.interventions.markBatchTerminal(item.operationId, item.batchId, 'timed_out');
  const controlled = await runtime.controlCompletedToolResult({
    operationId: item.operationId,
    toolMessageId: item.toolMessageId,
    result: {
      content: 'MCP user interaction timed out. The original tool operation was not repeated.',
      success: false,
      error: {
        code: 'MCP_ELICITATION_TIMEOUT',
        kind: 'stop',
        message: 'MCP user interaction timed out',
      },
      state: { mcpElicitation: null },
    },
  });
  await service.messages.updateToolMessage(item.toolMessageId, {
    content: controlled.result.content,
    onlyIfEmpty: true,
    pluginError: controlled.result.error ?? null,
    pluginState: controlled.result.state,
  });
  await service.messages.updateMessagePlugin(item.toolMessageId, {
    intervention: { batchId: item.batchId, operationId: item.operationId, status: 'none' },
  });
  await runtime.tryResumeParentFromAsyncTool(
    { parentOperationId: identity.operationId },
    { knownFulfilledMessageId: item.toolMessageId, scheduleVerifyOnHold: true },
  );
}
