import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { expireMcpElicitation } from '@/server/services/mcp/elicitation/expire';

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
  const runtime = new AgentRuntimeService(db, input.payload.userId, {
    workspaceId: input.payload.workspaceId,
  });
  await expireMcpElicitation(
    runtime.createMcpElicitationService(),
    input.payload.itemId,
    runtime.getMcpElicitationRuntime(),
  );
  return c.json({ success: true });
}
