import { describe, expect, it } from 'vitest';

import { isAgentMention } from './mentionTarget';

describe('isAgentMention', () => {
  it('trusts an explicit agent type', () => {
    expect(isAgentMention('anything', 'agent')).toBe(true);
  });

  it('recognises Agent ids when the type is missing or generic', () => {
    expect(isAgentMention('agt_123', undefined)).toBe(true);
    expect(isAgentMention('agt_123', 'member')).toBe(true);
  });

  it('treats other ids as people', () => {
    expect(isAgentMention('user_123', 'member')).toBe(false);
    expect(isAgentMention(undefined, undefined)).toBe(false);
  });
});
