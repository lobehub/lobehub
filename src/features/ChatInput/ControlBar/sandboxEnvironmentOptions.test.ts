import { describe, expect, it } from 'vitest';

import {
  isOnPublicDrive,
  pickableEnvironments,
  projectStartEnvironmentId,
  repositorySlug,
  selectionWithFolder,
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

describe('isOnPublicDrive', () => {
  it('is a workspace folder on the drive every member browses', () => {
    expect(isOnPublicDrive({ workingDirectory: 'team' }, 'ws')).toBe(true);
    expect(isOnPublicDrive({ drive: 'public', workingDirectory: 'team' }, 'ws')).toBe(true);
  });

  it("is not a member's personal drive, a temporary sandbox or a personal account", () => {
    expect(isOnPublicDrive({ drive: 'personal', workingDirectory: 'mine' }, 'ws')).toBe(false);
    expect(isOnPublicDrive({ environmentId: 'env' }, 'ws')).toBe(false);
    expect(isOnPublicDrive({ workingDirectory: 'notes' }, null)).toBe(false);
  });
});

describe('selectionWithFolder', () => {
  it('keeps the environment when a folder is picked', () => {
    expect(
      selectionWithFolder(
        { environmentId: 'env_repo01', instanceId: 'inst-1' },
        {
          drive: 'public',
          workingDirectory: 'team',
        },
      ),
    ).toEqual({ drive: 'public', environmentId: 'env_repo01', workingDirectory: 'team' });
  });
});

describe('projectStartEnvironmentId', () => {
  const git = { sources: [{ kind: 'git' as const, url: 'https://github.com/lobehub/lobe-write' }] };

  it('is the project environment that checks out a repository', () => {
    expect(projectStartEnvironmentId([{ configuration: git, id: 'env-project' }])).toBe(
      'env-project',
    );
  });

  // The server applies no environment without a repository (see `resolveProjectTopicSandbox`).
  it('is none when the project environment checks out no repository', () => {
    expect(projectStartEnvironmentId([{ configuration: { sources: [] }, id: 'env-project' }])).toBe(
      undefined,
    );
    expect(projectStartEnvironmentId([])).toBeUndefined();
  });
});
