import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';
import { and, eq, isNotNull } from 'drizzle-orm';

import { channelMembers } from '@/database/schemas';
import { appEnv } from '@/envs/app';

const log = debug('lobe-server:channel:notify');

/** Best-effort invalidation, not message delivery. The authorized DB view is the source of truth. */
export const notifyChannel = async (db: LobeChatDatabase, channelId: string) => {
  const gateway = appEnv.AGENT_GATEWAY_INTERNAL_URL || appEnv.AGENT_GATEWAY_URL;
  const token = appEnv.AGENT_GATEWAY_SERVICE_TOKEN;
  if (!gateway || !token) return;
  try {
    const members = await db
      .select({ userId: channelMembers.userId })
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, channelId),
          eq(channelMembers.actorType, 'user'),
          eq(channelMembers.status, 'active'),
          isNotNull(channelMembers.userId),
        ),
      );
    const userIds = members.flatMap(({ userId }) => (userId ? [userId] : []));
    for (let offset = 0; offset < userIds.length; offset += 500) {
      const result = await fetch(new URL('/api/channels/notify', gateway), {
        body: JSON.stringify({ channelId, userIds: userIds.slice(offset, offset + 500) }),
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(3000),
      });
      // Older gateways can still run Agents; clients revalidate on reconnect/focus.
      if (!result.ok) log('Gateway notification unavailable (%d)', result.status);
      await result.body?.cancel();
    }
  } catch (error) {
    log('Gateway notification failed: %O', error);
  }
};
