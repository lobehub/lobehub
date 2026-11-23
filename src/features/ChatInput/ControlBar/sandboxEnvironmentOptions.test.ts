import { describe, expect, it } from 'vitest';

import {
  environmentChipState,
  environmentFolderName,
  environmentSettingsPath,
  isOnPublicDrive,
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
  id: 'env_repo01',
  name: 'Writer',
};
const plainEnv = { id: 'env_plain02', name: 'Data tools' };

describe('environmentFolderName', () => {
  it("is named after the environment's repository, with a piece of its id", () => {
    expect(environmentFolderName(repoEnv)).toBe('lobe-write-repo01');
  });

  it('is named after the environment without a repository', () => {
    expect(environmentFolderName(plainEnv)).toBe('Data tools-lain02');
  });

  // Two environments of one repository must not share a folder: the setup
  // only runs in an empty one, so the second would keep the first's checkout.
  it('keeps two environments of the same repository apart', () => {
    expect(environmentFolderName({ ...repoEnv, id: 'env_other9' })).not.toBe(
      environmentFolderName(repoEnv),
    );
  });

  it('is always one visible path segment', () => {
    expect(environmentFolderName({ id: 'x1', name: '../a/b' })).toBe('-a-b-x1');
    expect(environmentFolderName({ id: 'x1', name: ' .hidden ' })).toBe('hidden-x1');
    expect(environmentFolderName({ id: 'x1', name: '..' })).toBe('environment-x1');
  });

  // The server refuses a working directory starting with `~`; a folder named
  // that way would send every run to a temporary sandbox.
  it('never produces a name the server refuses as a working directory', () => {
    expect(environmentFolderName({ id: 'x1', name: '~tools' })).toBe('tools-x1');
    expect(environmentFolderName({ id: '', name: '~.~' })).toBe('environment');
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

// T-14791: the drive and the environment are two options of one cloud sandbox.
describe('selectionWithDrive', () => {
  const defaultFolder = { drive: 'personal' as const, workingDirectory: 'notes' };

  it('keeps the environment when the drive is switched off', () => {
    expect(
      selectionWithDrive(
        { environmentId: 'env_repo01', workingDirectory: 'lobe-write-repo01' },
        false,
        {
          defaultFolder,
        },
      ),
    ).toEqual({ environmentId: 'env_repo01' });
    expect(selectionWithDrive({ workingDirectory: 'notes' }, false, { defaultFolder })).toEqual({});
  });

  it("switches on into the environment's own folder, so it is set up in an empty one", () => {
    expect(
      selectionWithDrive({ environmentId: 'env_repo01' }, true, {
        defaultFolder,
        environment: repoEnv,
      }),
    ).toEqual({
      drive: 'personal',
      environmentId: 'env_repo01',
      workingDirectory: 'lobe-write-repo01',
    });
  });

  it('switches on into the default folder without an environment', () => {
    expect(selectionWithDrive({}, true, { defaultFolder })).toEqual(defaultFolder);
  });
});

describe('selectionWithEnvironment', () => {
  it('only changes the environment off the drive', () => {
    expect(selectionWithEnvironment({}, repoEnv)).toEqual({ environmentId: 'env_repo01' });
    expect(selectionWithEnvironment({ environmentId: 'env_repo01' })).toEqual({});
  });

  it("moves a drive conversation into the environment's own folder", () => {
    expect(
      selectionWithEnvironment({ drive: 'personal', workingDirectory: 'notes' }, repoEnv),
    ).toEqual({
      drive: 'personal',
      environmentId: 'env_repo01',
      workingDirectory: 'lobe-write-repo01',
    });
  });

  it('keeps the folder when the environment is cleared on the drive', () => {
    expect(
      selectionWithEnvironment({
        environmentId: 'env_repo01',
        workingDirectory: 'lobe-write-repo01',
      }),
    ).toEqual({ workingDirectory: 'lobe-write-repo01' });
  });

  it('replaces a legacy environment directory', () => {
    expect(selectionWithEnvironment({ instanceId: 'inst-1' }, plainEnv)).toEqual({
      environmentId: 'env_plain02',
      workingDirectory: 'Data tools-lain02',
    });
    expect(selectionWithEnvironment({ instanceId: 'inst-1' })).toEqual({});
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
