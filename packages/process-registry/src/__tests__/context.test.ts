import { describe, expect, it } from 'vitest';

import { getProcessContext, runWithProcessContext } from '../context';

describe('runWithProcessContext', () => {
  it('returns empty object when no context is set', () => {
    expect(getProcessContext()).toEqual({});
  });

  it('sets context inside fn', () => {
    runWithProcessContext({ topicId: 't1' }, () => {
      expect(getProcessContext()).toEqual({ topicId: 't1' });
    });
    expect(getProcessContext()).toEqual({});
  });

  it('merges nested contexts — inner wins', () => {
    runWithProcessContext({ topicId: 't1', sessionId: 's1' }, () => {
      runWithProcessContext({ topicId: 't2' }, () => {
        const ctx = getProcessContext();
        expect(ctx.topicId).toBe('t2');
        expect(ctx.sessionId).toBe('s1');
      });
    });
  });

  it('propagates context across async awaits', async () => {
    await runWithProcessContext({ topicId: 't1' }, async () => {
      await Promise.resolve();
      expect(getProcessContext().topicId).toBe('t1');
    });
  });
});
