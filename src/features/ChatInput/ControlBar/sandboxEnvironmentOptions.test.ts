import { describe, expect, it } from 'vitest';

import {
  environmentChipState,
  environmentFolderName,
  environmentSettingsPath,
  pickableEnvironments,
  projectStartEnvironmentId,
  repositorySlug,
  selectionWithDrive,
  selectionWithEnvironment,
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

describe('environmentSettingsPath', () => {
  it("manages a project conversation's environment on the project's settings", () => {
    expect(environmentSettingsPath('project-1')).toBe('/project/project-1/settings/environments');
  });

  it("manages any other conversation's environments in the workspace's list", () => {
    expect(environmentSettingsPath()).toBe('/settings/environments');
  });
});

const repoEnv = {
  configuration: {
    sources: [{ kind: 'git' as const, url: 'https://github.com/lobehub/lobe-write.git' }],
  },
  id: 'env-repo',
  name: 'Writer',
};
const plainEnv = { id: 'env-plain', name: 'Data tools' };

describe('environmentFolderName', () => {
  it("is named after the environment's repository", () => {
    expect(environmentFolderName(repoEnv)).toBe('lobe-write');
  });

  it('is named after the environment without a repository', () => {
    expect(environmentFolderName(plainEnv)).toBe('Data tools');
  });

  it('is always one visible path segment', () => {
    expect(environmentFolderName({ name: '../a/b' })).toBe('-a-b');
    expect(environmentFolderName({ name: ' .hidden ' })).toBe('hidden');
    expect(environmentFolderName({ name: '..' })).toBe('environment');
  });
});

// T-14791: the drive and the environment are two options of one cloud sandbox.
describe('selectionWithDrive', () => {
  const defaultFolder = { drive: 'personal' as const, workingDirectory: 'notes' };

  it('keeps the environment when the drive is switched off', () => {
    expect(
      selectionWithDrive({ environmentId: 'env-repo', workingDirectory: 'lobe-write' }, false, {
        defaultFolder,
      }),
    ).toEqual({ environmentId: 'env-repo' });
    expect(selectionWithDrive({ workingDirectory: 'notes' }, false, { defaultFolder })).toEqual({});
  });

  it("switches on into the environment's own folder, so it is set up in an empty one", () => {
    expect(
      selectionWithDrive({ environmentId: 'env-repo' }, true, {
        defaultFolder,
        environment: repoEnv,
      }),
    ).toEqual({ drive: 'personal', environmentId: 'env-repo', workingDirectory: 'lobe-write' });
  });

  it('switches on into the default folder without an environment', () => {
    expect(selectionWithDrive({}, true, { defaultFolder })).toEqual(defaultFolder);
  });
});

describe('selectionWithEnvironment', () => {
  it('only changes the environment off the drive', () => {
    expect(selectionWithEnvironment({}, repoEnv)).toEqual({ environmentId: 'env-repo' });
    expect(selectionWithEnvironment({ environmentId: 'env-repo' })).toEqual({});
  });

  it("moves a drive conversation into the environment's own folder", () => {
    expect(
      selectionWithEnvironment({ drive: 'personal', workingDirectory: 'notes' }, repoEnv),
    ).toEqual({ drive: 'personal', environmentId: 'env-repo', workingDirectory: 'lobe-write' });
  });

  it('keeps the folder when the environment is cleared on the drive', () => {
    expect(
      selectionWithEnvironment({ environmentId: 'env-repo', workingDirectory: 'lobe-write' }),
    ).toEqual({ workingDirectory: 'lobe-write' });
  });

  it('replaces a legacy environment directory', () => {
    expect(selectionWithEnvironment({ instanceId: 'inst-1' }, plainEnv)).toEqual({
      environmentId: 'env-plain',
      workingDirectory: 'Data tools',
    });
    expect(selectionWithEnvironment({ instanceId: 'inst-1' })).toEqual({});
  });
});

describe('selectionWithFolder', () => {
  it('keeps the environment when a folder is picked', () => {
    expect(
      selectionWithFolder(
        { environmentId: 'env-repo', instanceId: 'inst-1' },
        {
          drive: 'public',
          workingDirectory: 'team',
        },
      ),
    ).toEqual({ drive: 'public', environmentId: 'env-repo', workingDirectory: 'team' });
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
