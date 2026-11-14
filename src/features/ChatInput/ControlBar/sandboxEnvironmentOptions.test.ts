import { describe, expect, it } from 'vitest';

import {
  environmentChipState,
  pickableEnvironments,
  repositorySelection,
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

describe('repositorySelection', () => {
  const repo = { id: 'env-repo', name: 'lobehub-biz/agent-mail' };

  it('starts a repository outside a project in a temporary sandbox', () => {
    expect(repositorySelection(repo, { published: false, workspace: true })).toEqual({
      environmentId: 'env-repo',
    });
  });

  // A pick in a project conversation used to drop the project's shared
  // checkout and start over in a temporary sandbox.
  it("keeps a project conversation in the project's checkout of the repository", () => {
    expect(
      repositorySelection(repo, { projectId: 'proj_1', published: false, workspace: false }),
    ).toEqual({
      environmentId: 'env-repo',
      workingDirectory: 'projects/proj_1/env-repo',
    });
  });

  it('puts a private checkout on the personal drive and a published one on the public drive', () => {
    expect(
      repositorySelection(repo, { projectId: 'proj_1', published: false, workspace: true }),
    ).toMatchObject({ drive: 'personal' });
    expect(
      repositorySelection(repo, { projectId: 'proj_1', published: true, workspace: true }),
    ).toMatchObject({ drive: 'public' });
  });
});
