import { describe, expect, it } from 'vitest';

import { repositoryLocalPath } from './RepositoryLocations';

describe('repositoryLocalPath', () => {
  it('is the project folder itself for a repository at the top', () => {
    expect(repositoryLocalPath({ path: '/work/app', platform: 'darwin' }, undefined)).toBe(
      '/work/app',
    );
  });

  it('is its subfolder when repositories sit side by side', () => {
    expect(repositoryLocalPath({ path: '/work/project/', platform: 'linux' }, 'lobe-ui')).toBe(
      '/work/project/lobe-ui',
    );
    expect(repositoryLocalPath({ path: 'C:\\code\\project', platform: 'win32' }, 'lobe-ui')).toBe(
      'C:\\code\\project\\lobe-ui',
    );
  });
});
