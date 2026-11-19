import { describe, expect, it } from 'vitest';

import { applyWorkingDirByDevicePatch } from './agencyConfig';

describe('applyWorkingDirByDevicePatch', () => {
  it('replaces a device selection without retaining another repository’s Git state', () => {
    const merged = {
      workingDirByDevice: {
        'device-a': {
          git: { activeWorktree: '/repos/titu-worktree', branch: 'master' },
          path: '/repos/lobehub',
          repoType: 'github',
        },
        'device-b': '/remote/repo',
      },
    };

    applyWorkingDirByDevicePatch(
      merged,
      {
        workingDirByDevice: { 'device-a': { path: '/repos/lobehub' } },
      },
      ['device-a'],
    );

    expect(merged.workingDirByDevice).toEqual({
      'device-a': { path: '/repos/lobehub' },
      'device-b': '/remote/repo',
    });
  });

  it('replaces Git metadata when returning from a worktree to its source repository', () => {
    const merged = {
      workingDirByDevice: {
        'device-a': {
          git: { activeWorktree: '/repos/worktree', branch: 'main' },
          path: '/repos/source',
        },
      },
    };

    applyWorkingDirByDevicePatch(
      merged,
      {
        workingDirByDevice: { 'device-a': { git: { branch: 'main' }, path: '/repos/source' } },
      },
      ['device-a'],
    );

    expect(merged.workingDirByDevice['device-a']).toEqual({
      git: { branch: 'main' },
      path: '/repos/source',
    });
  });

  it('deletes keys whose patch value is undefined', () => {
    const merged = { workingDirByDevice: { 'device-a': '/a', 'device-b': '/b' } };
    applyWorkingDirByDevicePatch(merged, { workingDirByDevice: { 'device-a': undefined } });
    expect(merged.workingDirByDevice).toEqual({ 'device-b': '/b' });
  });

  it('deletes keys whose patch value is null, the only delete a JSON patch can express', () => {
    // A deep merge has already copied the null over the stored selection.
    const merged = { workingDirByDevice: { 'device-a': null, 'device-b': '/b' } };
    applyWorkingDirByDevicePatch(merged, { workingDirByDevice: { 'device-a': null } });
    expect(merged.workingDirByDevice).toEqual({ 'device-b': '/b' });
  });

  it('leaves defined patch values untouched', () => {
    const merged = { workingDirByDevice: { 'device-a': '/a' } };
    applyWorkingDirByDevicePatch(merged, { workingDirByDevice: { 'device-a': '/a' } });
    expect(merged.workingDirByDevice).toEqual({ 'device-a': '/a' });
  });

  it('is a no-op when the patch has no workingDirByDevice', () => {
    const merged = { workingDirByDevice: { 'device-a': '/a' } };
    applyWorkingDirByDevicePatch(merged, {});
    applyWorkingDirByDevicePatch(merged, undefined);
    applyWorkingDirByDevicePatch(merged, null);
    expect(merged.workingDirByDevice).toEqual({ 'device-a': '/a' });
  });

  it('is a no-op when the merged target has no workingDirByDevice', () => {
    expect(() =>
      applyWorkingDirByDevicePatch({}, { workingDirByDevice: { 'device-a': undefined } }),
    ).not.toThrow();
    expect(() =>
      applyWorkingDirByDevicePatch(undefined, { workingDirByDevice: { 'device-a': undefined } }),
    ).not.toThrow();
  });
});
