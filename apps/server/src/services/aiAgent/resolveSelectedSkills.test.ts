import { describe, expect, it, vi } from 'vitest';

import { resolveSelectedSkillIds } from './resolveSelectedSkills';

describe('resolveSelectedSkillIds', () => {
  it('loads a builtin body and reference metadata without inline resource content', async () => {
    const result = await resolveSelectedSkillIds({
      findUserSkill: vi.fn(),
      ids: ['lobehub'],
    });

    expect(result?.[0]).toMatchObject({
      identifier: 'lobehub',
      name: 'lobehub',
      source: 'builtin',
    });
    expect(result?.[0].content).toContain('## Available Resources');
    expect(result?.[0].resources?.['references/agent']).toEqual(
      expect.objectContaining({ fileHash: expect.any(String), size: expect.any(Number) }),
    );
    expect(result?.[0].resources?.['references/agent']).not.toHaveProperty('content');
  });

  it('loads a user skill through the scoped lookup and preserves source', async () => {
    const findUserSkill = vi.fn().mockResolvedValue({
      content: 'T101 selected skill body',
      identifier: 't101-skill',
      name: 'T101 Skill',
      resources: {
        'references/notes.md': { fileHash: 'hash-notes', size: 12 },
      },
      source: 'user',
    });

    const result = await resolveSelectedSkillIds({
      findUserSkill,
      ids: ['t101-skill'],
    });

    expect(findUserSkill).toHaveBeenCalledWith('t101-skill');
    expect(result?.[0]).toMatchObject({
      content: expect.stringContaining('T101 selected skill body'),
      identifier: 't101-skill',
      resources: {
        'references/notes.md': { fileHash: 'hash-notes', size: 12 },
      },
      source: 'user',
    });
  });

  it('keeps client-resolved content and deduplicates repeats', async () => {
    const findUserSkill = vi.fn();
    const result = await resolveSelectedSkillIds({
      findUserSkill,
      ids: ['t101-skill', 't101-skill'],
      selectedSkills: [
        {
          content: 'client resolved body',
          identifier: 't101-skill',
          name: 'T101 Skill',
          source: 'user',
        },
      ],
    });

    expect(findUserSkill).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        content: 'client resolved body',
        identifier: 't101-skill',
        name: 'T101 Skill',
        source: 'user',
      },
    ]);
  });

  it('ignores unknown identifiers instead of inventing a skill body', async () => {
    const result = await resolveSelectedSkillIds({
      findUserSkill: vi.fn().mockResolvedValue(undefined),
      ids: ['missing-skill'],
    });

    expect(result).toBeUndefined();
  });
});
