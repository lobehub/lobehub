import { describe, expect, it } from 'vitest';

import { agentDisplayName } from './displayName';

describe('agentDisplayName', () => {
  it('prefers the personal name over the role', () => {
    expect(agentDisplayName({ name: '小艾', title: '健康助手' })).toBe('小艾');
  });

  it('falls back to the title for an agent with no name', () => {
    expect(agentDisplayName({ name: null, title: 'Health Assistant' })).toBe('Health Assistant');
  });

  it('treats a blank name as absent so it cannot beat a real title', () => {
    expect(agentDisplayName({ name: '   ', title: 'Health Assistant' })).toBe('Health Assistant');
  });

  it('trims the resolved label', () => {
    expect(agentDisplayName({ name: '  Alice  ' })).toBe('Alice');
  });

  it('uses the caller fallback when both fields are empty', () => {
    expect(agentDisplayName({ name: null, title: '  ' }, 'Custom Agent')).toBe('Custom Agent');
    expect(agentDisplayName(null, 'Custom Agent')).toBe('Custom Agent');
  });

  it('returns undefined without a fallback when nothing is set', () => {
    expect(agentDisplayName({})).toBeUndefined();
    expect(agentDisplayName(undefined)).toBeUndefined();
  });
});
