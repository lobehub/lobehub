import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCommitWorkingDirectory } from '../useCommitWorkingDirectory';

const testState = vi.hoisted(() => ({
  agent: {
    agencyConfig: undefined as Record<string, unknown> | undefined,
    agentMap: {} as Record<string, { visibility?: string; workspaceId?: string | null }>,
    localAgentWorkingDirectoryMap: {} as Record<string, string>,
    updateAgentConfigById: vi.fn(),
    updateAgentRuntimeEnvConfigById: vi.fn(),
  },
  chat: {
    activeTopicId: undefined as string | undefined,
    topic: undefined as { metadata?: Record<string, unknown> } | undefined,
    updateTopicMetadata: vi.fn(),
  },
  currentDeviceId: 'this-machine' as string | undefined,
  effective: {
    agencyConfig: undefined as Record<string, unknown> | undefined,
    workspaceScoped: false,
  },
}));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => testState.effective,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: typeof testState.agent) => unknown) => selector(testState.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { getAgencyConfigById: () => (s: typeof testState.agent) => s.agencyConfig },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: typeof testState.chat) => unknown) => selector(testState.chat),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { getTopicById: () => (s: typeof testState.chat) => s.topic },
}));

vi.mock('@/store/device', () => ({
  useDeviceStore: (selector: (s: { updateDeviceCwd: unknown }) => unknown) =>
    selector({ updateDeviceCwd: vi.fn() }),
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: { gatewayDeviceInfo?: { deviceId?: string } }) => unknown) =>
    selector({ gatewayDeviceInfo: { deviceId: testState.currentDeviceId } }),
}));

vi.mock('@/helpers/heteroSessionByWorkingDirectory', () => ({
  getHeteroSessionIdForWorkingDirectory: () => undefined,
}));

describe('useCommitWorkingDirectory — localTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.agent.agencyConfig = undefined;
    testState.agent.agentMap = {};
    testState.agent.localAgentWorkingDirectoryMap = {};
    testState.agent.updateAgentConfigById = vi.fn();
    testState.agent.updateAgentRuntimeEnvConfigById = vi.fn();
    testState.chat.activeTopicId = undefined;
    testState.chat.topic = undefined;
    testState.chat.updateTopicMetadata = vi.fn();
    testState.currentDeviceId = 'this-machine';
    testState.effective = { agencyConfig: undefined, workspaceScoped: false };
  });

  it('files a workspace member’s first sandbox pick against their own machine', async () => {
    // The caller selects `local` as part of the same action, so the config here
    // still describes the previous (workspace-shared) target — and selecting
    // first would not re-render in time. Without `localTarget` the path lands
    // in the shared row or nowhere, and the next command refuses again for
    // want of a working directory.
    testState.agent.agentMap = { 'agent-id': { visibility: 'public', workspaceId: 'ws-1' } };
    testState.effective = {
      agencyConfig: { boundDeviceId: 'shared-device', executionTarget: 'device' },
      workspaceScoped: true,
    };

    const { result } = renderHook(() => useCommitWorkingDirectory('agent-id'));
    await result.current.commit(
      { path: 'C:/Users/me/LobeHub/sandbox/agent-id' },
      {
        localTarget: true,
      },
    );

    // Per-user slot — never the workspace-shared row.
    expect(testState.agent.updateAgentRuntimeEnvConfigById).toHaveBeenCalledWith('agent-id', {
      workingDirectory: 'C:/Users/me/LobeHub/sandbox/agent-id',
    });
    expect(testState.agent.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('keeps a personal agent’s write on this device', async () => {
    const { result } = renderHook(() => useCommitWorkingDirectory('agent-id'));
    await result.current.commit({ path: 'C:/work' }, { localTarget: true });

    expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-id', {
      agencyConfig: { workingDirByDevice: { 'this-machine': { path: 'C:/work' } } },
    });
  });

  it('leaves ordinary writes routed by the resolved config', async () => {
    // No override: a `device` target still files against its bound device, so
    // the new option cannot change how the directory picker behaves.
    testState.effective = {
      agencyConfig: { boundDeviceId: 'other-device', executionTarget: 'device' },
      workspaceScoped: false,
    };
    testState.agent.agencyConfig = { boundDeviceId: 'other-device', executionTarget: 'device' };

    const { result } = renderHook(() => useCommitWorkingDirectory('agent-id'));
    await result.current.commit({ path: 'C:/work' });

    expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-id', {
      agencyConfig: {
        boundDeviceId: 'other-device',
        executionTarget: 'device',
        workingDirByDevice: { 'other-device': { path: 'C:/work' } },
      },
    });
  });
});

describe('useCommitWorkingDirectory — topic device provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.agent.agencyConfig = { boundDeviceId: 'device-b', executionTarget: 'device' };
    testState.agent.agentMap = {};
    testState.agent.localAgentWorkingDirectoryMap = {};
    testState.chat.activeTopicId = 'topic-id';
    // A conversation first pinned on device A, now running on device B.
    testState.chat.topic = {
      metadata: { boundDeviceId: 'device-a', workingDirectory: '/Users/me/repo-a' },
    };
    testState.chat.updateTopicMetadata = vi.fn();
    testState.currentDeviceId = 'this-machine';
    testState.effective = {
      agencyConfig: { boundDeviceId: 'device-b', executionTarget: 'device' },
      workspaceScoped: false,
    };
  });

  it('re-stamps the topic device with the directory picked for the new device', async () => {
    // The server only honours a topic pin on the device named by
    // `boundDeviceId`; leaving device A there would make device B skip the
    // directory just chosen for it and fall back to another cwd.
    const { result } = renderHook(() => useCommitWorkingDirectory('agent-id'));
    await result.current.commit({ path: '/home/me/repo-b' });

    expect(testState.chat.updateTopicMetadata).toHaveBeenCalledWith('topic-id', {
      boundDeviceId: 'device-b',
      workingDirectory: '/home/me/repo-b',
      workingDirectoryConfig: { path: '/home/me/repo-b' },
    });
  });

  it('drops the topic device together with a cleared directory', async () => {
    const { result } = renderHook(() => useCommitWorkingDirectory('agent-id'));
    await result.current.clear();

    // Clearing is carried as explicit `undefined` keys (a merge can't drop a
    // key), so the key itself must be present — not merely unset.
    const [topicId, patch] = testState.chat.updateTopicMetadata.mock.calls[0];
    expect(topicId).toBe('topic-id');
    expect(Object.keys(patch).sort()).toEqual([
      'boundDeviceId',
      'workingDirectory',
      'workingDirectoryConfig',
    ]);
    expect(patch.boundDeviceId).toBeUndefined();
  });
});
