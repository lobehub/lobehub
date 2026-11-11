import { describe, expect, it } from 'vitest';

import { environmentRepositoryUrl, reusableEnvironments } from './environmentSource';

const environment = (id: string, visibility: 'private' | 'public', url?: string) => ({
  configuration: { sources: url ? [{ kind: 'git' as const, url }] : [] },
  id,
  visibility,
});

describe('environmentRepositoryUrl', () => {
  it('reads the repository an environment checks out', () => {
    expect(
      environmentRepositoryUrl(
        environment('env_1', 'private', 'https://github.com/lobehub/lobehub'),
      ),
    ).toBe('https://github.com/lobehub/lobehub');
  });

  it('has nothing for an environment without a repository', () => {
    expect(environmentRepositoryUrl(environment('env_1', 'private'))).toBeUndefined();
    expect(environmentRepositoryUrl({ configuration: null, id: 'env_2' })).toBeUndefined();
  });
});

describe('reusableEnvironments', () => {
  const available = [
    environment('env_linked', 'public'),
    environment('env_private', 'private'),
    environment('env_public', 'public'),
  ];
  const linked = [{ id: 'env_linked' }];

  it('offers the environments not in the project yet', () => {
    expect(reusableEnvironments(available, linked).map((item) => item.id)).toEqual([
      'env_private',
      'env_public',
    ]);
  });

  it('offers only published environments to a shared project', () => {
    expect(reusableEnvironments(available, linked, true).map((item) => item.id)).toEqual([
      'env_public',
    ]);
  });
});
