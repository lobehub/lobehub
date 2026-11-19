import { describe, expect, it } from 'vitest';

import { repositorySourceKind } from './repository';

describe('repositorySourceKind', () => {
  it('identifies GitHub, TFS, and other Git repositories', () => {
    expect(repositorySourceKind('https://github.com/lobehub/lobehub')).toBe('github');
    expect(
      repositorySourceKind('http://dev.tellhowsoft.com/DefaultCollection/RSMP/_git/lobehub'),
    ).toBe('tfs');
    expect(repositorySourceKind('https://git.example.com/team/lobehub.git')).toBe('git');
  });
});
