import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { expireClientMcpStep } from '@/server/services/mcp/elicitation/clientStep';

const schema = z.object({
  payload: z.object({
    operationId: z.string(),
    userId: z.string(),
    workspaceId: z.string().optional(),
  }),
});
export async function mcpClientExpire(c: Context) {
  const { payload } = schema.parse(await c.req.json());
  const service = new AgentRuntimeService(await getServerDB(), payload.userId, {
    workspaceId: payload.workspaceId,
  }).createMcpElicitationService();
  await expireClientMcpStep(service, payload.operationId);
  return c.json({ success: true });
}
