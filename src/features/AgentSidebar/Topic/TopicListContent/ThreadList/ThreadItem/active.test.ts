import { describe, expect, it } from 'vitest';

import { isThreadRowActive } from './active';

describe('isThreadRowActive', () => {
  // Regression: OR-ing the portal thread with `activeThreadId` highlighted two
  // rows at once whenever the conversation and the Portal were on different
  // threads.
  it('marks only the portal thread when the conversation and the Portal differ', () => {
    expect(
      isThreadRowActive({ activeThreadId: 'thd_a', portalThreadId: 'thd_b', threadId: 'thd_b' }),
    ).toBe(true);
    expect(
      isThreadRowActive({ activeThreadId: 'thd_a', portalThreadId: 'thd_b', threadId: 'thd_a' }),
    ).toBe(false);
  });

  it('falls back to the conversation thread when the Portal shows no thread', () => {
    expect(
      isThreadRowActive({ activeThreadId: 'thd_a', portalThreadId: undefined, threadId: 'thd_a' }),
    ).toBe(true);
    expect(
      isThreadRowActive({ activeThreadId: 'thd_a', portalThreadId: undefined, threadId: 'thd_b' }),
    ).toBe(false);
  });
});
