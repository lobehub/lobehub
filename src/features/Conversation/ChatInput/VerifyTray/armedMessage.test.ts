import { describe, expect, it } from 'vitest';

import { pickArmedMessage } from './armedMessage';

const msg = (role: string, createdAt: number, content = `${role}@${createdAt}`) => ({
  content,
  createdAt,
  role,
});

describe('pickArmedMessage', () => {
  it('adopts the message sent after arming, not an older carried-over one', () => {
    // Regression: a goal armed at t=100 after the default conversation already
    // had a user message at t=10 must NOT skip to that older message.
    const messages = [msg('user', 10, 'carried over'), msg('user', 150, 'the armed one')];
    expect(pickArmedMessage(messages, 100)?.content).toBe('the armed one');
  });

  it('returns the message exactly at armedAt (inclusive)', () => {
    const messages = [msg('user', 100, 'exact')];
    expect(pickArmedMessage(messages, 100)?.content).toBe('exact');
  });

  it('ignores assistant/tool messages', () => {
    const messages = [msg('assistant', 120), msg('tool', 130), msg('user', 140, 'mine')];
    expect(pickArmedMessage(messages, 100)?.content).toBe('mine');
  });

  it('returns undefined when every message predates the arm (stale arm on a pre-existing topic)', () => {
    const messages = [msg('user', 10), msg('assistant', 20), msg('user', 30)];
    expect(pickArmedMessage(messages, 100)).toBeUndefined();
  });

  it('returns undefined for an empty conversation', () => {
    expect(pickArmedMessage([], 100)).toBeUndefined();
  });
});
