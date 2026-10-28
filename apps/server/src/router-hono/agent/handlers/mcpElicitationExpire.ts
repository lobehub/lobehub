import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { expireMcpElicitation } from '@/server/services/mcp/elicitation/expire';
import { McpElicitationService } from '@/server/services/mcp/elicitation/McpElicitationService';

const schema = z.object({
  payload: z.object({
    itemId: z.string().uuid(),
    userId: z.string(),
    workspaceId: z.string().optional(),
  }),
});

/** Registered behind QStash signature verification. */
export async function mcpElicitationExpire(c: Context) {
  const input = schema.parse(await c.req.json());
  const db = await getServerDB();
  await expireMcpElicitation(
    new McpElicitationService(db, input.payload.userId, input.payload.workspaceId),
    input.payload.itemId,
    new AgentRuntimeService(db, input.payload.userId, { workspaceId: input.payload.workspaceId }),
  );
  return c.json({ success: true });
}
