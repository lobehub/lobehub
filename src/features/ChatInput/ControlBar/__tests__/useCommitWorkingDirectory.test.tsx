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
  chat: { activeTopicId: undefined as string | undefined, updateTopicMetadata: vi.fn() },
  currentDeviceId: 'this-machine' as string | undefined,
  effective: {
    agencyConfig: undefined as Record<string, unknown> | undefined,
    workspaceScoped: false,
  },
}));

vi.mock('@lobehub/ui/base-ui', () => ({ confirmModal: vi.fn() }));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => testState.effective,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: typeof testState.agent) => unknown) => selector(testState.agent),
}));

vi.mock('@/store/agent/projection', () => ({
  agentProjectionSelectors: {
    agencyConfig: (agent: { agencyConfig?: Record<string, unknown> }) => agent.agencyConfig,
    workspaceScoped: (agent: { workspaceId?: string | null }) => Boolean(agent.workspaceId),
  },
  useAgentValue: (agentId: string, selector: (agent: Record<string, unknown>) => unknown) =>
    selector({ agencyConfig: testState.agent.agencyConfig, ...testState.agent.agentMap[agentId] }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: typeof testState.chat) => unknown) => selector(testState.chat),
}));

vi.mock('@/store/chat/slices/topic/projection', () => ({
  useChatTopicById: () => undefined,
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
