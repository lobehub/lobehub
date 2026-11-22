import debug from 'debug';

import { appEnv } from '@/envs/app';

const log = debug('lobe-server:user:notify');

/** The gateway's limit per request; larger lists are sent in batches. */
const MAX_USERS_PER_REQUEST = 500;

/**
 * Tell each user's open clients that something of theirs changed, named by `topic` (e.g.
 * `contacts`), through the Agent Gateway's user feed. Best-effort invalidation like
 * `notifyChannel`: no content is sent, the client re-reads the topic through the API, and it
 * re-reads after every reconnect, so a lost notice only delays a refresh. Never throws.
 */
export const notifyUsers = async (topic: string, userIds: string[]) => {
  const gateway = appEnv.AGENT_GATEWAY_INTERNAL_URL || appEnv.AGENT_GATEWAY_URL;
  const token = appEnv.AGENT_GATEWAY_SERVICE_TOKEN;
  const recipients = [...new Set(userIds.filter(Boolean))];
  if (!gateway || !token || recipients.length === 0) return;
  try {
    for (let offset = 0; offset < recipients.length; offset += MAX_USERS_PER_REQUEST) {
      const result = await fetch(new URL('/api/users/notify', gateway), {
        body: JSON.stringify({
          topic,
          userIds: recipients.slice(offset, offset + MAX_USERS_PER_REQUEST),
        }),
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(3000),
      });
      // An older gateway has no user feed; clients still refresh on reconnect and focus.
      if (!result.ok) log('Gateway user notification unavailable (%d)', result.status);
      await result.body?.cancel();
    }
  } catch (error) {
    log('Gateway user notification failed: %O', error);
  }
};
