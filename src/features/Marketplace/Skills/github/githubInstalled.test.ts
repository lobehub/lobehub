import { describe, expect, it } from 'vitest';

import { githubSkillRepo, githubSkillUrl } from './githubInstalled';

const manifest = { name: 'pdf' } as any;

describe('githubSkillUrl', () => {
  it('points at the tracked folder and ref', () => {
    const skill = {
      manifest,
      source: 'user' as const,
      upstream: { owner: 'o', path: 'skills/pdf', ref: 'main', repo: 'r' },
    };
    expect(githubSkillUrl(skill)).toBe('https://github.com/o/r/tree/main/skills/pdf');
    expect(githubSkillRepo(skill)).toBe('o/r');
  });

  it('points at the repository for a skill at its root', () => {
    expect(
      githubSkillUrl({
        manifest,
        source: 'user',
        upstream: { owner: 'o', path: '', ref: 'HEAD', repo: 'r' },
      }),
    ).toBe('https://github.com/o/r');
  });

  it('falls back to the address an untracked import came from', () => {
    expect(
      githubSkillUrl({
        manifest: { ...manifest, sourceUrl: 'https://github.com/o/r/tree/dev/a' },
        source: 'user',
      }),
    ).toBe('https://github.com/o/r/tree/dev/a');
  });

  it('is null for market skills and skills written by hand', () => {
    expect(githubSkillUrl({ manifest, source: 'market' })).toBeNull();
    expect(githubSkillUrl({ manifest, source: 'user' })).toBeNull();
  });
});
