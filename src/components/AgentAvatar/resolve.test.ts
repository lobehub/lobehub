import { DEFAULT_AVATAR } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { isDefaultAgentAvatar, resolveAgentAvatar } from './resolve';

describe('isDefaultAgentAvatar', () => {
  it('treats empty values and the legacy default image as no avatar', () => {
    expect(isDefaultAgentAvatar(undefined)).toBe(true);
    expect(isDefaultAgentAvatar(null)).toBe(true);
    expect(isDefaultAgentAvatar('')).toBe(true);
    expect(isDefaultAgentAvatar(DEFAULT_AVATAR)).toBe(true);
  });

  it('keeps an emoji or image the agent set', () => {
    expect(isDefaultAgentAvatar('🤖')).toBe(false);
    expect(isDefaultAgentAvatar('https://example.com/a.png')).toBe(false);
  });
});

describe('resolveAgentAvatar', () => {
  it('draws the generated character instead of the legacy default image', () => {
    expect(
      resolveAgentAvatar({ agentId: 'agt_1', avatar: DEFAULT_AVATAR, name: 'Researcher' }),
    ).toEqual({ kind: 'generated', label: 'Researcher', seed: 'agt_1' });
  });

  it('seeds by agent id, so a rename keeps the same character', () => {
    const before = resolveAgentAvatar({ agentId: 'agt_1', name: 'Before' });
    const after = resolveAgentAvatar({ agentId: 'agt_1', name: 'After' });

    expect(before.seed).toBe(after.seed);
  });

  it('falls back to the name, then the title, when there is no id', () => {
    expect(resolveAgentAvatar({ name: 'Writer', title: 'Tooltip' }).seed).toBe('Writer');
    expect(resolveAgentAvatar({ title: 'Tooltip' }).seed).toBe('Tooltip');
  });

  it('keeps a custom avatar', () => {
    expect(resolveAgentAvatar({ agentId: 'agt_1', avatar: '🤖', name: 'Bot' })).toEqual({
      avatar: '🤖',
      kind: 'custom',
      label: 'Bot',
      seed: 'agt_1',
    });
  });
});
