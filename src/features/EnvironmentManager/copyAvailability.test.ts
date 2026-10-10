import { describe, expect, it } from 'vitest';

import { copyBlockReason } from './copyAvailability';

describe('copyBlockReason', () => {
  const idle = { buildId: null, inUse: false, status: 'ready' };

  it('allows a copy of an idle, built copy', () => {
    expect(copyBlockReason(idle, false)).toBeUndefined();
  });

  it('blocks a copy a run is holding — the server answers INSTANCE_IN_USE', () => {
    expect(copyBlockReason({ ...idle, inUse: true }, false)).toBe('inUse');
  });

  it('does not read an unanswered lease store as free', () => {
    expect(copyBlockReason(idle, true)).toBe('occupancyUnknown');
  });

  it('blocks a copy whose build is replacing its folder', () => {
    expect(copyBlockReason({ ...idle, buildId: 'b1', status: 'pending' }, false)).toBe('building');
  });

  it('allows a never-built copy, which nothing is writing to', () => {
    expect(copyBlockReason({ ...idle, status: 'pending' }, false)).toBeUndefined();
  });
});
