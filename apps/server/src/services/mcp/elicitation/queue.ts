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
  const queue = new QueueService();
  const impl = queue.getImpl();
  if (impl instanceof LocalQueueServiceImpl)
    impl.setExecutionCallback(() =>
      executeMcpElicitationResume(service, itemId, resolutionRequestId).then(() => {}),
    );
  const base = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';
  await queue.scheduleMessage({
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
  return { state: 'resolving' as const };
}

export async function executeMcpElicitationResume(
  service: McpElicitationService,
  itemId: string,
  resolutionRequestId: string,
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
  return resumeMcpElicitation(service, {
    itemId,
    resolutionRequestId,
    responses: JSON.parse(String(resolution.action.result.responses)),
  });
}
