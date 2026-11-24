import { describe, expect, it } from 'vitest';

import { customSkillsOf } from './customSkillFilter';

const manifest = { name: 'skill' } as any;

const cli = {
  description: 'Made with lh skill create',
  manifest,
  name: 'My Notes',
  source: 'user' as const,
};
const github = {
  ...cli,
  name: 'From GitHub',
  upstream: { owner: 'o', path: 'skills/pdf', ref: 'main', repo: 'r' },
};
const legacyGithub = {
  ...cli,
  manifest: { ...manifest, sourceUrl: 'https://github.com/o/r' },
  name: 'Legacy GitHub',
};
const market = { ...cli, name: 'Market', source: 'market' as const };
const builtin = { ...cli, name: 'Builtin', source: 'builtin' as const };

describe('customSkillsOf', () => {
  it('keeps user skills that have no GitHub origin', () => {
    expect(customSkillsOf([cli, github, legacyGithub, market, builtin])).toEqual([cli]);
  });

  it('keeps a user skill imported from a non-GitHub address', () => {
    const fromUrl = {
      ...cli,
      manifest: { ...manifest, sourceUrl: 'https://example.com/skill.zip' },
    };
    expect(customSkillsOf([fromUrl])).toEqual([fromUrl]);
  });

  it('matches the query against name and description', () => {
    expect(customSkillsOf([cli], 'notes')).toEqual([cli]);
    expect(customSkillsOf([cli], 'LH SKILL')).toEqual([cli]);
    expect(customSkillsOf([cli], 'pdf')).toEqual([]);
  });
});
