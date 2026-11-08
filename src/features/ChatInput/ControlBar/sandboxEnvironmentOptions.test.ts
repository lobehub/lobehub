import { describe, expect, it } from 'vitest';

import {
  environmentChipState,
  pickableEnvironments,
  repositorySlug,
} from './sandboxEnvironmentOptions';

const environments = [
  { id: 'mine', visibility: 'private' },
  { id: 'team', visibility: 'public' },
];

describe('pickableEnvironments', () => {
  it('offers a workspace-public agent the published environments only', () => {
    expect(pickableEnvironments(environments, true).map((e) => e.id)).toEqual(['team']);
  });

  it('offers everyone else every environment they can read, their own private ones included', () => {
    expect(pickableEnvironments(environments, false).map((e) => e.id)).toEqual(['mine', 'team']);
  });
});

describe('environmentChipState', () => {
  it('names the picked environment once the list has it', () => {
    expect(
      environmentChipState({
        current: { name: 'Tools' },
        environmentId: 'env',
        failed: false,
        loaded: true,
      }),
    ).toEqual({ kind: 'picked', name: 'Tools' });
  });

  it('does not call a picked environment "none" while the list loads or after it failed', () => {
    expect(environmentChipState({ environmentId: 'env', failed: false, loaded: false })).toEqual({
      kind: 'loading',
    });
    expect(environmentChipState({ environmentId: 'env', failed: true, loaded: false })).toEqual({
      kind: 'loadFailed',
    });
  });

  it('says a picked environment is unavailable only when the loaded list lacks it', () => {
    expect(environmentChipState({ environmentId: 'env', failed: false, loaded: true })).toEqual({
      kind: 'missing',
    });
    expect(environmentChipState({ failed: true, loaded: false })).toEqual({ kind: 'none' });
  });
});

describe('repositorySlug', () => {
  const withUrl = (url: string) => ({
    configuration: { sources: [{ kind: 'git' as const, url }] },
  });

  it('reads owner/name from a repository URL', () => {
    expect(repositorySlug(withUrl('https://github.com/lobehub/lobehub'))).toBe('lobehub/lobehub');
  });

  it('drops a .git suffix', () => {
    expect(repositorySlug(withUrl('https://github.com/lobehub/lobe.id.git'))).toBe(
      'lobehub/lobe.id',
    );
  });

  it('says nothing without a parsable source', () => {
    expect(repositorySlug({ configuration: null })).toBeUndefined();
    expect(repositorySlug(withUrl('not a url'))).toBeUndefined();
  });
});
