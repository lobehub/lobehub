// Registers the in-process runner for a sweep that runs before any Channel request.
import './ChannelCoordinator';

import type { LobeChatDatabase } from '@lobechat/database';
import { and, asc, eq, lt, min, or } from 'drizzle-orm';
import pMap from 'p-map';

import { channelJobs, channelMessages } from '@/database/schemas';

import { wakeChannel } from './queue';

/** Bounded outbox recovery, invoked by the existing runtime recovery sweep. Never replays a run. */
export const recoverChannels = async (db: LobeChatDatabase) => {
  const cutoff = new Date(Date.now() - 60_000);
  const [jobs, routing] = await Promise.all([
    db
      .select({ channelId: channelJobs.channelId })
      .from(channelJobs)
      .where(
        and(
          lt(channelJobs.updatedAt, cutoff),
          or(
            eq(channelJobs.status, 'queued'),
            eq(channelJobs.status, 'running'),
            eq(channelJobs.writerHeld, true),
          ),
        ),
      )
      .groupBy(channelJobs.channelId)
      .orderBy(asc(min(channelJobs.updatedAt)))
      .limit(50),
    db
      .select({ channelId: channelMessages.channelId })
      .from(channelMessages)
      .where(
        and(eq(channelMessages.routingStatus, 'pending'), lt(channelMessages.createdAt, cutoff)),
      )
      .groupBy(channelMessages.channelId)
      .orderBy(asc(min(channelMessages.createdAt)))
      .limit(50),
  ]);
  const ids = [...new Set([...jobs, ...routing].map((row) => row.channelId))];
  // Try every wakeup even when one fails, then report the failure once.
  let failed = false;
  await pMap(
    ids,
    async (id) => {
      try {
        await wakeChannel(id);
      } catch (error) {
        failed = true;
        console.error('[channel:recover]', id, error);
      }
    },
    { concurrency: 10 },
  );
  if (failed) throw new Error('Channel recovery could not enqueue every wakeup');
};
