import { describe, expect, it, vi } from 'vitest';

import { unreadableVersions } from './skillVersions';

vi.mock('@/services/userSkill', () => ({ userSkillService: {} }));

describe('unreadableVersions', () => {
  const error = new Error('storage down');

  // A failed read has to surface: it must not read as still loading.
  it('names a version that failed with nothing to show', () => {
    const failed = { error };
    expect(unreadableVersions([{ body: '# v1' }, failed])).toEqual([failed]);
  });

  it('leaves out one still loading', () => {
    expect(unreadableVersions([{}])).toEqual([]);
  });

  it('leaves out one whose text survived a failed refresh', () => {
    expect(unreadableVersions([{ body: '', error }])).toEqual([]);
  });
});
