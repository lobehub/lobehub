// @vitest-environment node
import type { LobeAgentAgencyConfig, TaskExecutionConfig } from '@lobechat/types';
import { toTaskExecutionConfigPatch } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  resolveRunDeviceId,
  resolveTaskRunExecution,
  resolveTopicExecutionPatch,
} from './resolveRunExecution';

describe('resolveTaskRunExecution', () => {
  it('returns nothing for a task that pins nothing, so the run inherits the agent', () => {
    expect(resolveTaskRunExecution(undefined, undefined)).toBeUndefined();
    expect(resolveTaskRunExecution({} as TaskExecutionConfig, undefined)).toBeUndefined();
  });

  it('forwards a device pin as the run deviceId', () => {
    expect(resolveTaskRunExecution({ boundDeviceId: 'device-a' }, 'device-a')).toEqual({
      deviceId: 'device-a',
    });
  });

  it('carries a local working directory with its repo type', () => {
    expect(
      resolveTaskRunExecution(
        {
          boundDeviceId: 'device-a',
          workingDirectory: '/Users/me/Code/lobehub',
          workingDirectoryConfig: { path: '/Users/me/Code/lobehub', repoType: 'github' },
        },
        'device-a',
      ),
    ).toEqual({
      deviceId: 'device-a',
      initialTopicMetadata: {
        workingDirectory: '/Users/me/Code/lobehub',
        workingDirectoryConfig: { path: '/Users/me/Code/lobehub', repoType: 'github' },
      },
    });
  });

  it('falls back to the primary repo when only repos were selected', () => {
    expect(resolveTaskRunExecution({ repos: ['lobehub/lobehub'] }, undefined)).toEqual({
      initialTopicMetadata: {
        repos: ['lobehub/lobehub'],
        workingDirectory: 'lobehub/lobehub',
        workingDirectoryConfig: { path: 'lobehub/lobehub', repoType: 'github' },
      },
    });
  });

  it('lets an explicit directory config win over the path and the repos', () => {
    expect(
      resolveTaskRunExecution(
        {
          repos: ['lobehub/lobehub'],
          workingDirectory: '/tmp/ignored',
          workingDirectoryConfig: { path: '/Users/me/Code/other', repoType: 'git' },
        },
        undefined,
      ),
    ).toEqual({
      initialTopicMetadata: {
        repos: ['lobehub/lobehub'],
        workingDirectory: '/Users/me/Code/other',
        workingDirectoryConfig: { path: '/Users/me/Code/other', repoType: 'git' },
      },
    });
  });

  it('keeps the directory when the run lands on the machine it was picked for', () => {
    // The policy-fixed device and the task's pin are the same machine, so the
    // directory is exactly where the run goes.
    expect(
      resolveTaskRunExecution(
        { boundDeviceId: 'device-a', workingDirectory: '/a/project' },
        'device-a',
      ),
    ).toEqual({
      deviceId: 'device-a',
      initialTopicMetadata: {
        workingDirectory: '/a/project',
        workingDirectoryConfig: { path: '/a/project' },
      },
    });
  });

  it('leaves a pinned machine directory behind when the run lands elsewhere', () => {
    // The workspace author fixed the agent to another machine AFTER the task
    // picked A with `/a/project`. The pin is dropped for routing, so its path
    // has to go with it: the topic gets stamped with the EFFECTIVE device, which
    // makes the residency check in `resolveDeviceWorkingDirectoryConfig` read
    // another machine's absolute path as this run's own.
    expect(
      resolveTaskRunExecution(
        { boundDeviceId: 'device-a', workingDirectory: '/a/project' },
        'device-b',
      ),
    ).toEqual({ deviceId: 'device-a' });

    // …and the same when the fixed target is the sandbox, where no device-local
    // path can be used at all.
    expect(
      resolveTaskRunExecution(
        { boundDeviceId: 'device-a', workingDirectory: '/a/project' },
        undefined,
      ),
    ).toEqual({ deviceId: 'device-a' });
  });

  it('keeps the repos of a task pinned to a device the run does not use', () => {
    // `repos` belong to the assignee agent's provider env, not to a machine, so
    // they are the part of the selection a run elsewhere can still act on.
    expect(
      resolveTaskRunExecution(
        { boundDeviceId: 'device-a', repos: ['lobehub/lobehub'] },
        'device-b',
      ),
    ).toEqual({
      deviceId: 'device-a',
      initialTopicMetadata: {
        repos: ['lobehub/lobehub'],
        workingDirectory: 'lobehub/lobehub',
        workingDirectoryConfig: { path: 'lobehub/lobehub', repoType: 'github' },
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
        { execution: { boundDeviceId: 'device-a', workingDirectory: '/srv/app' } },
        'device-a',
      ),
    ).toBeUndefined();

    expect(resolveTopicExecutionPatch({}, {}, undefined)).toBeUndefined();
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
        { execution: { boundDeviceId: 'device-b', workingDirectory: '/b/project' } },
        'device-b',
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
        { execution: { repos: ['lobehub/lobehub'] } },
        undefined,
      ),
    ).toEqual({
      boundDeviceId: undefined,
      repos: ['lobehub/lobehub'],
      workingDirectory: 'lobehub/lobehub',
      workingDirectoryConfig: { path: 'lobehub/lobehub', repoType: 'github' },
    });
  });

  it('clears the axes a task no longer pins, so "inherit the agent" wins', () => {
    // A cleared selection is persisted as `null` axes (`toTaskExecutionConfigPatch`).
    expect(
      resolveTopicExecutionPatch(
        {
          boundDeviceId: 'device-a',
          repos: ['lobehub/lobehub'],
          workingDirectory: 'lobehub/lobehub',
          workingDirectoryConfig: { path: 'lobehub/lobehub', repoType: 'github' },
        },
        { execution: toTaskExecutionConfigPatch(undefined) },
        undefined,
      ),
    ).toEqual({
      boundDeviceId: undefined,
      repos: undefined,
      workingDirectory: undefined,
      workingDirectoryConfig: undefined,
    });
  });

  it('clears a continued topic directory whose machine the run no longer uses', () => {
    // Same hazard as the fresh-topic case, one run later: the topic was written
    // on A with `/a/project`, but the run now goes elsewhere, so the stored path
    // must not survive the sync — the topic's own values outrank the run's.
    expect(
      resolveTopicExecutionPatch(
        { boundDeviceId: 'device-a', workingDirectory: '/a/project' },
        { execution: { boundDeviceId: 'device-a', workingDirectory: '/a/project' } },
        'device-b',
      ),
    ).toEqual({
      boundDeviceId: 'device-a',
      repos: undefined,
      workingDirectory: undefined,
      workingDirectoryConfig: undefined,
    });
  });

  it('leaves a continued topic alone when the task never selected a run location', () => {
    // Legacy and untouched tasks carry no `execution` block. Their topic's device
    // and directory are where the continued CLI session lives; clearing them
    // would let a since-changed agent target move the run and lose the session.
    const topic = {
      boundDeviceId: 'device-a',
      workingDirectory: '/a/project',
      workingDirectoryConfig: { path: '/a/project' },
    };

    expect(resolveTopicExecutionPatch(topic, {}, undefined)).toBeUndefined();
    expect(resolveTopicExecutionPatch(topic, null, undefined)).toBeUndefined();
    expect(
      resolveTopicExecutionPatch(topic, { model: 'gpt-4o', provider: 'openai' }, undefined),
    ).toBeUndefined();
  });

  it('leaves the rest of the topic metadata to the merge', () => {
    const patch = resolveTopicExecutionPatch(
      { boundDeviceId: 'device-a', cronJobId: 'cron-1', workingDirectory: '/a' },
      { execution: { boundDeviceId: 'device-b' } },
      'device-b',
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

describe('resolveRunDeviceId', () => {
  const fixedDevice: LobeAgentAgencyConfig = {
    boundDeviceId: 'device-b',
    executionTarget: 'device',
    executionTargetSelectionPolicy: 'fixed',
  };

  it('keeps the task pin while members pick the target', () => {
    expect(
      resolveRunDeviceId(
        { boundDeviceId: 'device-a' },
        { boundDeviceId: 'device-b', executionTarget: 'device' },
        'ws-1',
      ),
    ).toBe('device-a');
  });

  it("uses the agent's fixed device instead of the task pin", () => {
    expect(resolveRunDeviceId({ boundDeviceId: 'device-a' }, fixedDevice, 'ws-1')).toBe('device-b');
  });

  it('names no device when the fixed target is not a device', () => {
    expect(
      resolveRunDeviceId(
        { boundDeviceId: 'device-a' },
        { executionTarget: 'sandbox', executionTargetSelectionPolicy: 'fixed' },
        'ws-1',
      ),
    ).toBeUndefined();
  });

  it('ignores a fixed policy outside a workspace', () => {
    // The policy is a workspace contract; a personal agent's own member
    // preference is what its runs follow, so the task pin stands.
    expect(resolveRunDeviceId({ boundDeviceId: 'device-a' }, fixedDevice)).toBe('device-a');
  });
});
