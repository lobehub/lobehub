import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:agent:exec');

/**
 * Start a new agent operation. Body shape:
 * `{ userId, agentId | slug, prompt, appContext?, autoStart?, existingMessageIds? }`.
 *
 * Auth: handled by `qstashOrApiKeyAuth` on the route — QStash signature OR
 * `AGENT_EXEC_API_KEY` Bearer token. Either passes.
 */
export async function execAgent(c: Context): Promise<Response> {
  const startTime = Date.now();

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

  const {
    userId,
    agentId,
    slug,
    prompt,
    appContext,
    autoStart = true,
    existingMessageIds,
  } = body as Record<string, unknown> & { autoStart?: boolean };

  if (!userId) return c.json({ error: 'userId is required' }, 400);
  if (!agentId && !slug) {
    return c.json({ error: 'Either agentId or slug is required' }, 400);
  }
  if (!prompt) return c.json({ error: 'prompt is required' }, 400);

  log('[exec] Starting agent execution for user %s, agent %s', userId, agentId || slug);

  try {
    const serverDB = await getServerDB();
    const aiAgentService = new AiAgentService(serverDB, userId as string);

    const result = await aiAgentService.execAgent({
      agentId: agentId as string | undefined,
      appContext: appContext as any,
      autoStart,
      existingMessageIds: existingMessageIds as string[] | undefined,
      prompt: prompt as string,
      slug: slug as string | undefined,
    });

    const executionTime = Date.now() - startTime;
    log('[exec] Completed in %dms, operationId: %s', executionTime, result.operationId);

    return c.json({ ...result, executionTime });
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[exec] Error in agent execution: %O', error);
    return c.json({ error: message, executionTime }, 500);
  }
}
