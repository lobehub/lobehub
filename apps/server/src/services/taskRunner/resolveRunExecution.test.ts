// @vitest-environment node
import type { TaskExecutionConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveTaskRunExecution } from './resolveRunExecution';

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
