import { describe, expect, it } from 'vitest';

import { resolveTaskOpenTarget } from './taskRef';

describe('historical task cards', () => {
  it('prefers stable state identity and never overrides it with display aliases', () => {
    expect(
      resolveTaskOpenTarget({ taskId: 'task_old', identifier: 'T-1' }, { identifier: 'T-2' }),
    ).toBe('task_old');
  });
  it('opens historical cards through identifier and argument fallbacks', () => {
    expect(resolveTaskOpenTarget({ identifier: 'T-1' }, { identifier: 'T-2' })).toBe('T-1');
    expect(resolveTaskOpenTarget(undefined, { identifier: 'T-2' })).toBe('T-2');
    expect(resolveTaskOpenTarget()).toBeUndefined();
  });
});
