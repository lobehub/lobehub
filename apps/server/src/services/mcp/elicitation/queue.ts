import { appEnv } from '@/envs/app';
import { QueueService } from '@/server/services/queue';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';

import type { McpElicitationService } from './McpElicitationService';
import { resumeMcpElicitation } from './resume';

/** Queue only immutable outbox identity; form values stay in the scoped database. */
export async function scheduleMcpElicitationResume(
  service: McpElicitationService,
  itemId: string,
  resolutionRequestId: string,
) {
  const item = await service.get(itemId);
  if (!item.toolMessageId) throw new Error('Missing MCP tool message');
  const { pending } = await service.loadContinuation(item.toolMessageId);
  if (pending.legacy) return { state: 'resolving' as const };
  const token = await service.invocations.claimDispatch(item.operationId, resolutionRequestId);
  if (!token) return { state: 'resolving' as const };
  const queue = new QueueService();
  const impl = queue.getImpl();
  if (impl instanceof LocalQueueServiceImpl)
    impl.setExecutionCallback(() =>
      executeMcpElicitationResume(service, itemId, resolutionRequestId).then(() => {}),
    );
  const base = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';
  const messageId = await queue.scheduleMessage({
    endpoint: `${base.replace(/\/$/, '')}/api/agent/mcp-elicitation-resume`,
    operationId: item.operationId,
    stepIndex: pending.checkpoint?.round ?? 0,
    deduplicationId: `mcp-resume-${resolutionRequestId}`,
    payload: {
      itemId,
      resolutionRequestId,
      userId: service.userId,
      workspaceId: service.workspaceId,
    },
  });
  await service.invocations.acknowledgeDispatch(
    item.operationId,
    resolutionRequestId,
    token,
    messageId,
  );
  return { state: 'resolving' as const };
}

export async function executeMcpElicitationResume(
  service: McpElicitationService,
  itemId: string,
  resolutionRequestId: string,
  runtime = service.runtime,
) {
  const resolution = await service.interventions.findResolutionByRequestId(resolutionRequestId);
  const item = await service.get(itemId);
  if (
    !resolution ||
    resolution.batchId !== item.batchId ||
    resolution.source !== 'mcp' ||
    resolution.actorId !== service.userId ||
    resolution.action.type !== 'submit_custom'
  )
    throw new Error('Invalid MCP resolution outbox identity');
  return resumeMcpElicitation(
    service,
    {
      itemId,
      resolutionRequestId,
      responses: JSON.parse(String(resolution.action.result.responses)),
    },
    runtime,
  );
}

/** A subsequent read can recover a claim whose enqueue or enqueue ACK was lost. */
export async function recoverMcpElicitationResume(service: McpElicitationService, itemId: string) {
  const item = await service.get(itemId);
  if (item.status !== 'resolving' || !item.toolMessageId) return;
  const { pending } = await service.loadContinuation(item.toolMessageId);
  if (pending.legacy || pending.batchId !== item.batchId) return;
  const batch = await service.interventions.findBatch(item.operationId, item.batchId);
  const resolution = batch.resolutions.find(
    (entry) => entry.actorId === service.userId && entry.source === 'mcp',
  );
  if (resolution)
    return scheduleMcpElicitationResume(service, itemId, resolution.resolutionRequestId);
}
