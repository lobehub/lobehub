import { describe, expect, it } from 'vitest';

import { parseGithubSource } from './githubSource';

describe('parseGithubSource', () => {
  it('reads owner/repo as the whole repository', () => {
    expect(parseGithubSource('anthropics/skills')).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      url: 'https://github.com/anthropics/skills',
    });
  });

  it('reads a GitHub address with or without its scheme', () => {
    expect(parseGithubSource('github.com/anthropics/skills.git')?.url).toBe(
      'https://github.com/anthropics/skills',
    );
    expect(parseGithubSource('https://www.github.com/anthropics/skills/')?.url).toBe(
      'https://github.com/anthropics/skills',
    );
  });

  it('keeps the ref and folder of a tree URL', () => {
    expect(
      parseGithubSource('https://github.com/anthropics/skills/tree/main/skills/pdf'),
    ).toMatchObject({
      path: 'skills/pdf',
      ref: 'main',
      url: 'https://github.com/anthropics/skills/tree/main/skills/pdf',
    });
  });

  it('turns a SKILL.md blob link into its folder', () => {
    expect(
      parseGithubSource('https://github.com/o/r/blob/dev/.claude/skills/x/SKILL.md'),
    ).toMatchObject({ path: '.claude/skills/x', ref: 'dev' });
  });

  it('follows the default branch for a HEAD folder link', () => {
    expect(parseGithubSource('https://github.com/o/r/tree/HEAD/skills/a')).toMatchObject({
      path: 'skills/a',
      ref: undefined,
      url: 'https://github.com/o/r/tree/HEAD/skills/a',
    });
  });

  it('reads an SSH clone address', () => {
    expect(parseGithubSource('git@github.com:o/r.git')?.url).toBe('https://github.com/o/r');
  });

  it('takes the source out of an `npx skills add` command', () => {
    expect(parseGithubSource('npx skills add vercel-labs/agent-skills --skill react')?.url).toBe(
      'https://github.com/vercel-labs/agent-skills',
    );
    expect(parseGithubSource('pnpm dlx skills add https://github.com/o/r')?.url).toBe(
      'https://github.com/o/r',
    );
  });

  it('leaves search words and other hosts alone', () => {
    expect(parseGithubSource('pdf')).toBeNull();
    expect(parseGithubSource('pdf tools')).toBeNull();
    expect(parseGithubSource('https://gitlab.com/o/r')).toBeNull();
    expect(parseGithubSource('https://github.com/o')).toBeNull();
    expect(parseGithubSource('a/b/c')).toBeNull();
  });
});
