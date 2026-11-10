import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getTopicBoundDeviceId, isTopicDeviceUnknown } from './executionTarget';

describe('getTopicBoundDeviceId', () => {
  it('returns the machine an agent topic is pinned to', () => {
    expect(
      getTopicBoundDeviceId({ agentId: 'agt', metadata: { boundDeviceId: 'dev-a' } }, 'agt'),
    ).toBe('dev-a');
  });

  it('ignores another agent topic and a group topic owned by someone else', () => {
    expect(
      getTopicBoundDeviceId({ agentId: 'other', metadata: { boundDeviceId: 'dev-a' } }, 'agt'),
    ).toBeUndefined();
    expect(
      getTopicBoundDeviceId({ groupId: 'grp', metadata: { boundDeviceId: 'dev-a' } }, 'agt'),
    ).toBeUndefined();
  });

  it('returns nothing for an unbound topic', () => {
    expect(getTopicBoundDeviceId({ agentId: 'agt', metadata: {} }, 'agt')).toBeUndefined();
    expect(getTopicBoundDeviceId(undefined, 'agt')).toBeUndefined();
  });
});

describe('isTopicDeviceUnknown', () => {
  const deviceTarget: LobeAgentAgencyConfig = { boundDeviceId: 'dev-b', executionTarget: 'device' };

  // Regression: a topic whose cwd lives on another computer showed the agent
  // default machine as if the conversation belonged to it.
  it('flags a topic that holds a cwd but never recorded its machine', () => {
    const topic = { agentId: 'agt', metadata: { workingDirectory: '/Users/other/repo' } };
    expect(isTopicDeviceUnknown(topic, 'agt', deviceTarget)).toBe(true);
    expect(
      isTopicDeviceUnknown(
        { agentId: 'agt', metadata: { workingDirectoryConfig: { path: '/Users/other/repo' } } },
        'agt',
        deviceTarget,
      ),
    ).toBe(true);
  });

  it('trusts a recorded machine and a topic without a cwd', () => {
    expect(
      isTopicDeviceUnknown(
        { agentId: 'agt', metadata: { boundDeviceId: 'dev-a', workingDirectory: '/repo' } },
        'agt',
        deviceTarget,
      ),
    ).toBe(false);
    expect(isTopicDeviceUnknown({ agentId: 'agt', metadata: {} }, 'agt', deviceTarget)).toBe(false);
    expect(isTopicDeviceUnknown(undefined, 'agt', deviceTarget)).toBe(false);
  });

  it('leaves project-directory topics, other owners and fixed targets alone', () => {
    const metadata = { workingDirectory: '/repo' };
    expect(
      isTopicDeviceUnknown(
        { agentId: 'agt', metadata, projectWorkingDirectoryId: 'dir' },
        'agt',
        deviceTarget,
      ),
    ).toBe(false);
    expect(isTopicDeviceUnknown({ agentId: 'other', metadata }, 'agt', deviceTarget)).toBe(false);
    expect(isTopicDeviceUnknown({ groupId: 'grp', metadata }, 'agt', deviceTarget)).toBe(false);
    expect(
      isTopicDeviceUnknown({ agentId: 'agt', metadata }, 'agt', {
        ...deviceTarget,
        executionTargetSelectionPolicy: 'fixed',
      }),
    ).toBe(false);
  });
});
