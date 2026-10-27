import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { ChannelCoordinator } from '@/server/services/channel/ChannelCoordinator';
import { wakeChannel } from '@/server/services/channel/queue';

const channelId = z.string().regex(/^chn_[\dA-Za-z]{12}$/);

/** Queue envelopes carry identity only; every execution fact is read from the database. */
export const channelAdvance = async (c: Context) => {
  const input = z.object({ payload: z.object({ channelId }) }).safeParse(await c.req.json());
  if (!input.success) return c.json({ error: 'Invalid Channel queue envelope' }, 400);
  await new ChannelCoordinator(await getServerDB()).advance(input.data.payload.channelId);
  return c.json({ success: true });
};

/** The router verifies the QStash signature before accepting a terminal notification. */
export const channelCallback = async (c: Context) => {
  const input = z
    .object({ channelId, jobId: z.uuid(), operationId: z.string().min(1) })
    .safeParse(await c.req.json());
  if (!input.success) return c.json({ error: 'Invalid Channel completion' }, 400);
  const { channelId: id, jobId, operationId } = input.data;
  await new ChannelCoordinator(await getServerDB()).complete(id, jobId, operationId);
  await wakeChannel(id);
  return c.json({ success: true });
};
