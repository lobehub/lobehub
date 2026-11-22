/** bun examples/retries.ts — timeouts, retries and an idempotent create. */
/* eslint-disable no-console -- examples print their results */
import { randomUUID } from 'node:crypto';

import { createLobeHub } from '@lobehub/sdk';

import { options } from './client';

// GETs (and other idempotent requests) retry up to 4 times on 408/429/5xx and
// network errors, honoring Retry-After; each attempt gets 15s for headers.
const lobehub = createLobeHub({ ...options(), maxRetries: 4, throwOnError: true, timeout: 15_000 });

await lobehub.agents.list({ timeout: 5000 });

// A POST is only retried with an idempotency key: the server runs it once and
// replays the answer for repeats, so a retry can never create a second agent.
const key = randomUUID();
const first = await lobehub.agents.create({
  body: { title: 'Idempotent agent' },
  idempotencyKey: key,
});
const again = await lobehub.agents.create({
  body: { title: 'Idempotent agent' },
  idempotencyKey: key,
});
console.log(first.data.data.id === again.data.data.id ? 'same agent' : 'two agents?!');
console.log('replayed:', again.response.headers.get('Idempotent-Replayed'));

await lobehub.agents.delete({ path: { id: first.data.data.id } });
