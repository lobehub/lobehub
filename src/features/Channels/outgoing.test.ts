import { describe, expect, it } from 'vitest';

import { timelineTail } from './outgoing';

const failed = [{ message: { id: 'outgoing:request' } }];

describe('timelineTail', () => {
  it('changes when a reply arrives while a failed message stays last', () => {
    const before = timelineTail([{ id: 'a' }], failed);
    const after = timelineTail([{ id: 'a' }, { id: 'reply' }], failed);

    expect(after).not.toBe(before);
  });

  it('changes when this tab queues a message', () => {
    expect(timelineTail([{ id: 'a' }], failed)).not.toBe(timelineTail([{ id: 'a' }], []));
  });

  it('stays the same when nothing was added at either end', () => {
    expect(timelineTail([{ id: 'a' }], failed)).toBe(timelineTail([{ id: 'a' }], failed));
    expect(timelineTail(undefined, [])).toBe(timelineTail([], []));
  });
});
