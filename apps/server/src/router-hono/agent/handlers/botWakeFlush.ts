import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { handleWakeFlush } from '@/server/services/bot/wake/scheduler';

const payloadSchema = z.object({
  payload: z.object({
    applicationId: z.string().min(1),
    at: z.number(),
    channelKey: z.string().min(1),
    platform: z.string().min(1),
  }),
});

/**
 * The bot-wake scheduler's delayed trigger. QStash can deliver it more than once and early; the
 * scheduler treats a flush that is not yet due as a no-op that books the next one.
 */
export async function botWakeFlush(c: Context): Promise<Response> {
  const body = payloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid flush payload' }, 400);

  try {
    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

    await handleWakeFlush(body.data.payload, async (platform, applicationId) => {
      const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
        serverDB,
        platform,
        applicationId,
        gateKeeper,
      );

      return provider
        ? {
            settings: provider.settings as Record<string, unknown> | undefined,
            userId: provider.userId,
          }
        : undefined;
    });

    return c.json({ success: true });
  } catch {
    return c.json({ error: 'Wake flush failed' }, 500);
  }
}
