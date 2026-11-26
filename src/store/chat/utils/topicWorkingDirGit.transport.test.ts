import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTopicGitTransport } from './topicWorkingDirGit';

const env = vi.hoisted(() => ({
  agency: undefined as Record<string, unknown> | undefined,
  currentDeviceId: 'dev-here' as string | undefined,
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  isDesktop: true,
}));
vi.mock('@/store/agent', () => ({ getAgentStoreState: () => ({}) }));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => () => env.agency,
    getAgentModelById: () => () => 'gpt-5',
  },
}));
vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({
    gatewayDeviceInfo: env.currentDeviceId ? { deviceId: env.currentDeviceId } : undefined,
  }),
}));

describe('resolveTopicGitTransport', () => {
  beforeEach(() => {
    env.agency = { boundDeviceId: 'dev-b', executionTarget: 'device' };
    env.currentDeviceId = 'dev-here';
  });

  it("follows the agent's target without a topic binding", () => {
    expect(resolveTopicGitTransport('a1')).toMatchObject({ deviceId: 'dev-b' });
  });

  it("keeps a topic on its bound device after the agent's default moved", () => {
    expect(resolveTopicGitTransport('a1', 'dev-a')).toMatchObject({
      deviceId: 'dev-a',
      targetDeviceId: 'dev-a',
    });
  });

  it('reads this machine over IPC when the topic is bound to it', () => {
    expect(resolveTopicGitTransport('a1', 'dev-here')).toMatchObject({
      deviceId: undefined,
      isLocalDevice: true,
    });
  });

  it('lets a fixed selection policy win over the topic binding, as runs do', () => {
    env.agency = { ...env.agency, executionTargetSelectionPolicy: 'fixed' };
    expect(resolveTopicGitTransport('a1', 'dev-a')).toMatchObject({ deviceId: 'dev-b' });
  });
});
