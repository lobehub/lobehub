import { describe, expect, it } from 'vitest';

import { AGENT_CHARACTER_SEEDS, agentCharacterOptions } from './characters';
import { resolveAgentAvatar } from './resolve';

describe('AGENT_CHARACTER_SEEDS', () => {
  it('offers a fixed set of distinct characters', () => {
    expect(AGENT_CHARACTER_SEEDS.length).toBeGreaterThanOrEqual(12);
    expect(AGENT_CHARACTER_SEEDS.length).toBeLessThanOrEqual(24);
    expect(new Set(AGENT_CHARACTER_SEEDS).size).toBe(AGENT_CHARACTER_SEEDS.length);
  });
});

describe('agentCharacterOptions', () => {
  it('offers the same characters in the same order for every agent', () => {
    expect(agentCharacterOptions().map(({ seed }) => seed)).toEqual([...AGENT_CHARACTER_SEEDS]);
    expect(agentCharacterOptions('🤖')).toEqual(agentCharacterOptions(null));
  });

  it('writes generated:<seed>, which draws that character for any agent', () => {
    const [, , third] = agentCharacterOptions();

    expect(third.avatar).toBe(`generated:${AGENT_CHARACTER_SEEDS[2]}`);
    expect(resolveAgentAvatar({ agentId: 'agt_1', avatar: third.avatar })).toEqual({
      kind: 'generated',
      label: undefined,
      seed: AGENT_CHARACTER_SEEDS[2],
    });
  });

  it('marks only the character the avatar picked', () => {
    const options = agentCharacterOptions(`generated:${AGENT_CHARACTER_SEEDS[1]}`);

    expect(options.filter(({ selected }) => selected).map(({ seed }) => seed)).toEqual([
      AGENT_CHARACTER_SEEDS[1],
    ]);
  });

  it('marks nothing for an emoji, an image, or an agent without an avatar', () => {
    for (const value of ['🤖', 'https://example.com/a.png', null, undefined]) {
      expect(agentCharacterOptions(value).some(({ selected }) => selected)).toBe(false);
    }
  });
});
