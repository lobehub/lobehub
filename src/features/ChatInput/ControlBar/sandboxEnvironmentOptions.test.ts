import { describe, expect, it } from 'vitest';

import {
  environmentChipState,
  pickableEnvironments,
  repositoryFolder,
  repositorySelection,
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

describe('repositoryFolder', () => {
  it('keeps a plain repository name', () => {
    expect(repositoryFolder('lobe.id')).toBe('repos/lobe.id');
  });

  it('cannot climb out of the repos folder', () => {
    expect(repositoryFolder('../../etc')).toBe('repos/etc');
  });

  it('keeps non-latin names and falls back when nothing is left', () => {
    expect(repositoryFolder('前端 仓库')).toBe('repos/前端-仓库');
    expect(repositoryFolder('...')).toBe('repos/repository');
  });
});

describe('repositorySelection', () => {
  const environment = { id: 'env_1', name: 'lobehub' };

  it('starts in a temporary sandbox when the clone is not kept', () => {
    expect(repositorySelection(environment, { keep: false })).toEqual({ environmentId: 'env_1' });
  });

  it('never reuses the folder the conversation was on when kept', () => {
    expect(repositorySelection(environment, { keep: true })).toEqual({
      drive: undefined,
      environmentId: 'env_1',
      workingDirectory: 'repos/lobehub',
    });
  });

  it('keeps a workspace clone on the personal drive', () => {
    expect(repositorySelection(environment, { keep: true, workspaceId: 'ws_1' }).drive).toBe(
      'personal',
    );
  });
});
