import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

import { resolveReviewAccess } from '@/server/services/acceptanceReview/access';
import { subscribeResourceEvents } from '@/server/services/resourceEvents';

import type { ReviewEnv } from './auth';

const PING_MS = 25_000;
// Vercel kills the function at 300s; ending first turns that into an ordinary
// reconnect, and the client refetches on every connect anyway.
const MAX_STREAM_MS = 280_000;

export const streamEvents = (c: Context<ReviewEnv>) => {
  const acceptanceId = c.get('access').acceptance.id;
  const db = c.get('db');
  const userId = c.get('userId');

  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    stream.onAbort(() => ac.abort());
    const send = (event: string) => stream.writeSSE({ data: '{}', event }).catch(() => ac.abort());

    const ping = setInterval(() => {
      resolveReviewAccess(db, userId, acceptanceId).then(
        (access) => (access ? send('ping') : ac.abort()),
        () => ac.abort(),
      );
    }, PING_MS);
    const deadline = setTimeout(() => ac.abort(), MAX_STREAM_MS);

    const subscription = subscribeResourceEvents(
      { id: acceptanceId, type: 'acceptance' },
      (event) => void send(event.type),
      ac.signal,
    ).catch(() => ac.abort());
    await send('ready');

    await new Promise<void>((resolve) => {
      if (ac.signal.aborted) resolve();
      else ac.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    clearInterval(ping);
    clearTimeout(deadline);
    await subscription;
  });
};
