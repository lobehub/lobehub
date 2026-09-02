import { describe, expect, it } from 'vitest';

import { assertSyncConsumerPausedFor } from '../syncConsumerGuard';

describe('assertSyncConsumerPausedFor', () => {
  it('allows an upgrade step when nothing is in flight and nothing is dead', () => {
    expect(() => assertSyncConsumerPausedFor({ dead: 0, inFlight: 0 })).not.toThrow();
  });

  it('refuses while the sync consumer still holds Outbox claims', () => {
    expect(() => assertSyncConsumerPausedFor({ dead: 0, inFlight: 2 })).toThrow('in-flight claims');
  });

  it('refuses while dead letters would be frozen into the new index', () => {
    expect(() => assertSyncConsumerPausedFor({ dead: 1, inFlight: 0 })).toThrow('dead letters');
  });
});
