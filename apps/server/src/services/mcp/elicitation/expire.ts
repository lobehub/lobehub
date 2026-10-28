import type { AgentRuntimeService } from '@/server/services/agentRuntime';

import type { McpElicitationService } from './McpElicitationService';
import { recoverMcpElicitationResume } from './queue';

/** Durable deadline callback. Old rounds cannot expire a newer request on the same tool. */
export async function expireMcpElicitation(
  service: McpElicitationService,
  itemId: string,
  runtime: Pick<AgentRuntimeService, 'controlCompletedToolResult' | 'tryResumeParentFromAsyncTool'>,
  options: { rearm?: boolean } = {},
) {
  const item = await service.get(itemId);
  if (
    !item.toolMessageId ||
    !['timed_out', 'session_ended', 'pending', 'resolving'].includes(item.status)
  )
    return;
  // The durable wakeup also drives saved-answer recovery, independently of any open page.
  if (item.status === 'resolving') await recoverMcpElicitationResume(service, item.id);
  if (item.deadline.getTime() > Date.now()) {
    await service.scheduleExpiry(
      item.id,
      item.operationId,
      Math.min(item.deadline.getTime(), Date.now() + 30_000),
      0,
      true,
    );
    return;
  }
  const plugin = await service.messages.findMessagePlugin(item.toolMessageId);
  const stored = plugin?.state?.mcpElicitation as { batchId?: string } | undefined;
  if (!stored || stored.batchId !== item.batchId) return;
  const operation = await service.operations.findById(item.operationId);
  if (!operation || ['done', 'error', 'interrupted', 'abandoned'].includes(operation.status)) {
    const terminal = await service.interventions.markBatchTerminal(
      item.operationId,
      item.batchId,
      'session_ended',
    );
    if (!terminal.some((row) => row.id === item.id && row.status === 'session_ended')) return;
    await service.messages.updateMessagePlugin(item.toolMessageId, {
      intervention: { batchId: item.batchId, operationId: item.operationId, status: 'none' },
    });
    return;
  }
  const { identity, pending } = await service.loadContinuation(item.toolMessageId);
  if (pending.batchId !== item.batchId) return;
  const terminal = await service.interventions.markBatchTerminal(
    item.operationId,
    item.batchId,
    'timed_out',
  );
  if (!terminal.some((row) => row.id === item.id && row.status === 'timed_out')) {
    const execution = await service.invocations.execution(item.id);
    if (
      options.rearm !== false &&
      (execution?.state === 'executing' || execution?.state === 'completed')
    )
      await service.scheduleExpiry(
        item.id,
        item.operationId,
        Math.max(
          Date.now() + 15_000,
          Math.min(
            Math.max(
              execution.leaseExpiresAt?.getTime() ?? 0,
              Number(execution.dispatchUntil ?? 0),
            ),
            Date.now() + 30_000,
          ),
        ),
        0,
        true,
      );
    return;
  }
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
    pluginState: { ...controlled.result.state, mcpElicitation: pending, mcpClientComplete: true },
  });
  await runtime.tryResumeParentFromAsyncTool(
    { parentOperationId: identity.operationId },
    { knownFulfilledMessageId: item.toolMessageId, scheduleVerifyOnHold: true },
  );
  // The saved timeout must remain discoverable if parent dispatch/ACK fails.
  await service.messages.updatePluginState(item.toolMessageId, { mcpElicitation: null });
  await service.messages.updateMessagePlugin(item.toolMessageId, {
    intervention: { batchId: item.batchId, operationId: item.operationId, status: 'none' },
  });
}
