import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { ChannelError } from '@/database/repositories/channel';
import { ChannelCoordinator } from '@/server/services/channel/ChannelCoordinator';
import { runChannelWatchReport } from '@/server/services/channel/ChannelThreadService';
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

const watchReport = z.object({
  payload: z.object({
    agent: z.object({ agentId: z.string().min(1), memberId: z.uuid(), name: z.string().min(1) }),
    channelId,
    intervalMinutes: z.number().int().min(1).max(120),
    maxReports: z.number().int().min(1).max(48),
    operationId: z.string().min(1),
    prompt: z.string().optional(),
    report: z.number().int().min(1),
    threadIds: z.array(z.string().min(1)).min(1).max(10),
    userId: z.string().min(1),
    watchId: z.uuid(),
    workspaceId: z.string().optional(),
  }),
});

/** One scheduled progress report of a Thread watch (`lobe-channel.watchThreads`). */
export const channelWatchReport = async (c: Context) => {
  const input = watchReport.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'Invalid Channel watch report' }, 400);
  try {
    const result = await runChannelWatchReport(await getServerDB(), input.data.payload);
    return c.json({ result, success: true });
  } catch (error) {
    // The Channel refused the post (access lost, Channel archived): the watch ends here.
    if (error instanceof ChannelError) {
      console.warn('[channelWatchReport] watch %s ended:', input.data.payload.watchId, error);
      return c.json({ result: 'ended', success: true });
    }
    console.error('[channelWatchReport] report failed:', error);
    return c.json({ error: 'Channel watch report failed' }, 500);
  }
};
