import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { executeMcpElicitationResume } from '@/server/services/mcp/elicitation/queue';

const schema = z.object({
  payload: z.object({
    itemId: z.string().uuid(),
    resolutionRequestId: z.string().uuid(),
    userId: z.string(),
    workspaceId: z.string().optional(),
  }),
});
export async function mcpElicitationResume(c: Context) {
  const { payload } = schema.parse(await c.req.json());
  const result = await executeMcpElicitationResume(
    new AgentRuntimeService(await getServerDB(), payload.userId, {
      workspaceId: payload.workspaceId,
    }).createMcpElicitationService(),
    payload.itemId,
    payload.resolutionRequestId,
  );
  // A live fenced worker owns completion; duplicate queue deliveries are acknowledged.
  return c.json(result);
}
