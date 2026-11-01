import { describe, expect, it, vi } from 'vitest';

import { loadBuiltinSkill, loadBuiltinSkills } from './loadBuiltinSkills';

const chunk = vi.hoisted(() => ({ attempts: 0, failFirst: true }));

vi.mock('@lobechat/builtin-skills', () => {
  chunk.attempts += 1;
  if (chunk.failFirst && chunk.attempts === 1) throw new Error('chunk load failed');
  return {
    builtinSkills: [
      {
        content: '# Artifacts',
        description: '',
        identifier: 'lobe-artifacts',
        name: 'artifacts',
        source: 'builtin',
      },
    ],
  };
});

vi.mock('@/helpers/skillFilters', () => ({
  filterBuiltinSkills: (skills: unknown[]) => skills,
}));

describe('loadBuiltinSkills', () => {
  it('retries the import after a failed chunk load instead of caching the rejection', async () => {
    await expect(loadBuiltinSkills()).rejects.toThrow();

    const skill = await loadBuiltinSkill('lobe-artifacts');

    expect(skill?.content).toBe('# Artifacts');
    expect(chunk.attempts).toBe(2);
  });

  it('loads the package once after it succeeded', async () => {
    await Promise.all([loadBuiltinSkills(), loadBuiltinSkills()]);

    expect(chunk.attempts).toBe(2);
  });
});
