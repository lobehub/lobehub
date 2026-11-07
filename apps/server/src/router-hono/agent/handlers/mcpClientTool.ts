import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { executeClientMcpTool } from '@/server/services/mcp/elicitation/clientStep';

const schema = z.object({
  payload: z.object({
    userId: z.string(),
    workspaceId: z.string().optional(),
    identity: z.object({
      operationId: z.string(),
      assistantMessageId: z.string(),
      toolMessageId: z.string(),
      toolCallId: z.string(),
      apiName: z.string(),
      identifier: z.string(),
    }),
  }),
});
export async function mcpClientTool(c: Context) {
  const { payload } = schema.parse(await c.req.json());
  const service = new AgentRuntimeService(await getServerDB(), payload.userId, {
    workspaceId: payload.workspaceId,
  }).createMcpElicitationService();
  await executeClientMcpTool(service, payload.identity);
  return c.json({ success: true });
}
