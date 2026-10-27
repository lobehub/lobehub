import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { McpElicitationService } from '@/server/services/mcp/elicitation/McpElicitationService';
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
    new McpElicitationService(await getServerDB(), payload.userId, payload.workspaceId),
    payload.itemId,
    payload.resolutionRequestId,
  );
  return c.json(result, result.state === 'resolving' ? 409 : 200);
}
