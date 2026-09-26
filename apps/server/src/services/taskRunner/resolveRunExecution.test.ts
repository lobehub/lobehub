// @vitest-environment node
import type { TaskExecutionConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveTaskRunExecution, resolveTopicExecutionPatch } from './resolveRunExecution';

describe('resolveTaskRunExecution', () => {
  it('returns nothing for a task that pins nothing, so the run inherits the agent', () => {
    expect(resolveTaskRunExecution(undefined)).toBeUndefined();
    expect(resolveTaskRunExecution({} as TaskExecutionConfig)).toBeUndefined();
  });

  it('forwards a device pin as the run deviceId', () => {
    expect(resolveTaskRunExecution({ boundDeviceId: 'device-a' })).toEqual({
      deviceId: 'device-a',
    });
  });

  it('carries a local working directory with its repo type', () => {
    expect(
      resolveTaskRunExecution({
        boundDeviceId: 'device-a',
        workingDirectory: '/Users/me/Code/lobehub',
        workingDirectoryConfig: { path: '/Users/me/Code/lobehub', repoType: 'github' },
      }),
    ).toEqual({
      deviceId: 'device-a',
      initialTopicMetadata: {
        workingDirectory: '/Users/me/Code/lobehub',
        workingDirectoryConfig: { path: '/Users/me/Code/lobehub', repoType: 'github' },
      },
    });
  });

  it('falls back to the primary repo when only repos were selected', () => {
    expect(resolveTaskRunExecution({ repos: ['lobehub/lobehub'] })).toEqual({
      initialTopicMetadata: {
        repos: ['lobehub/lobehub'],
        workingDirectory: 'lobehub/lobehub',
        workingDirectoryConfig: { path: 'lobehub/lobehub', repoType: 'github' },
      },
    });
  });

  it('lets an explicit directory config win over the path and the repos', () => {
    expect(
      resolveTaskRunExecution({
        repos: ['lobehub/lobehub'],
        workingDirectory: '/tmp/ignored',
        workingDirectoryConfig: { path: '/Users/me/Code/other', repoType: 'git' },
      }),
    ).toEqual({
      initialTopicMetadata: {
        repos: ['lobehub/lobehub'],
        workingDirectory: '/Users/me/Code/other',
        workingDirectoryConfig: { path: '/Users/me/Code/other', repoType: 'git' },
      },
    });
  });
});

describe('resolveTopicExecutionPatch', () => {
  it('writes nothing when the topic already carries the selection', () => {
    // The common case: a task that has not been retargeted continues its topic
    // without paying for a write.
    expect(
      resolveTopicExecutionPatch(
        {
          boundDeviceId: 'device-a',
          workingDirectory: '/srv/app',
          workingDirectoryConfig: { path: '/srv/app' },
        },
        { boundDeviceId: 'device-a', workingDirectory: '/srv/app' },
      ),
    ).toBeUndefined();

    expect(resolveTopicExecutionPatch({}, undefined)).toBeUndefined();
  });

  it('moves a continued topic to the machine the task now pins', () => {
    // The bug this guards: a topic created on device A keeps routing with A's
    // directory because the topic's own metadata outranks the run's.
    expect(
      resolveTopicExecutionPatch(
        {
          boundDeviceId: 'device-a',
          workingDirectory: '/a/project',
          workingDirectoryConfig: { path: '/a/project' },
        },
        { boundDeviceId: 'device-b', workingDirectory: '/b/project' },
      ),
    ).toEqual({
      boundDeviceId: 'device-b',
      repos: undefined,
      workingDirectory: '/b/project',
      workingDirectoryConfig: { path: '/b/project' },
    });
  });

  it('replaces a device directory with the repo the task now selects', () => {
    expect(
      resolveTopicExecutionPatch(
        {
          boundDeviceId: 'device-a',
          workingDirectory: '/a/project',
          workingDirectoryConfig: { path: '/a/project' },
        },
        { repos: ['lobehub/lobehub'] },
      ),
    ).toEqual({
      boundDeviceId: undefined,
      repos: ['lobehub/lobehub'],
      workingDirectory: 'lobehub/lobehub',
      workingDirectoryConfig: { path: 'lobehub/lobehub', repoType: 'github' },
    });
  });

  it('clears the axes a task no longer pins, so "inherit the agent" wins', () => {
    expect(
      resolveTopicExecutionPatch(
        {
          boundDeviceId: 'device-a',
          repos: ['lobehub/lobehub'],
          workingDirectory: 'lobehub/lobehub',
          workingDirectoryConfig: { path: 'lobehub/lobehub', repoType: 'github' },
        },
        undefined,
      ),
    ).toEqual({
      boundDeviceId: undefined,
      repos: undefined,
      workingDirectory: undefined,
      workingDirectoryConfig: undefined,
    });
  });

  it('leaves the rest of the topic metadata to the merge', () => {
    const patch = resolveTopicExecutionPatch(
      { boundDeviceId: 'device-a', cronJobId: 'cron-1', workingDirectory: '/a' },
      { boundDeviceId: 'device-b' },
    );

    // Only the execution axes are asserted on; `updateMetadata` merges, so the
    // patch must not carry (or drop) anything else.
    expect(Object.keys(patch ?? {}).sort()).toEqual([
      'boundDeviceId',
      'repos',
      'workingDirectory',
      'workingDirectoryConfig',
    ]);
  });
});
