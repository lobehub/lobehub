import { describe, expect, it } from 'vitest';

import { isServerDeliveringQueuedMessage, type QueuedMessage } from './types';

const queued = (patch: Partial<QueuedMessage> = {}): QueuedMessage => ({
  content: 'next',
  createdAt: 1,
  id: 'q1',
  interruptMode: 'soft',
  ...patch,
});

describe('isServerDeliveringQueuedMessage', () => {
  it('is true for a follow-up the server holds and a run already took', () => {
    expect(
      isServerDeliveringQueuedMessage(queued({ serverDelivering: true, serverDelivery: 'server' })),
    ).toBe(true);
  });

  it('is false for one still waiting on the server', () => {
    expect(isServerDeliveringQueuedMessage(queued({ serverDelivery: 'server' }))).toBe(false);
  });

  // A stop hands it back to this client: the row must offer its actions
  // again, even if the flag from the last poll was never cleared.
  it('is false once only this client holds it again', () => {
    expect(isServerDeliveringQueuedMessage(queued({ serverDelivering: true }))).toBe(false);
    expect(
      isServerDeliveringQueuedMessage(
        queued({ serverDelivering: true, serverDelivery: 'appending' }),
      ),
    ).toBe(false);
  });
});
