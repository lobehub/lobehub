import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelectExecutionTarget } from './useSelectExecutionTarget';

const state = vi.hoisted(() => ({
  config: {
    agencyConfig: { executionTarget: 'local', boundDeviceId: 'device-a' },
    canSelectExecutionTarget: true,
  },
  chat: {
    activeAgentId: 'agent',
    activeTopicId: 'topic-a' as string | undefined,
    createTopic: vi.fn(),
    updateTopicMetadata: vi.fn(),
    switchTopic: vi.fn(),
  },
  desktop: true,
  deviceInfo: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return state.desktop;
  },
}));
vi.mock('@lobehub/ui/base-ui', () => ({ toast: { error: state.toast } }));
vi.mock('i18next', () => ({ t: (key: string) => key }));
vi.mock('@/hooks/useTopicAgencyConfig', () => ({ useTopicAgencyConfig: () => state.config }));
vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    (selector: (s: typeof state.chat) => unknown) => selector(state.chat),
    { getState: () => state.chat },
  ),
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: object) => unknown) =>
    selector({ gatewayDeviceInfo: undefined }),
}));
vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { getDeviceInfo: state.deviceInfo },
}));

describe('Topic execution selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.chat.activeTopicId = 'topic-a';
    state.chat.activeAgentId = 'agent';
    state.config.canSelectExecutionTarget = true;
    state.chat.createTopic.mockResolvedValue('new-topic');
    state.chat.updateTopicMetadata.mockResolvedValue(undefined);
  });
  it('saves only the selected Topic and clears its device for sandbox', async () => {
    const { result } = renderHook(() => useSelectExecutionTarget('agent'));
    await result.current('sandbox');
    expect(state.chat.updateTopicMetadata).toHaveBeenCalledWith('topic-a', {
      executionConfig: {
        executionTarget: 'sandbox',
        inheritWorkspaceScope: false,
        boundDeviceId: undefined,
        localSandbox: undefined,
        localSandboxNetwork: undefined,
      },
    });
    expect(state.config.agencyConfig).toEqual({
      executionTarget: 'local',
      boundDeviceId: 'device-a',
    });
  });
  it('does not write B when device discovery finishes after switching away from A', async () => {
    let resolve!: (value: { deviceId: string }) => void;
    state.deviceInfo.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useSelectExecutionTarget('agent'));
    const selection = result.current('local');
    state.chat.activeTopicId = 'topic-b';
    resolve({ deviceId: 'device-a' });
    await selection;
    expect(state.chat.updateTopicMetadata).toHaveBeenCalledWith(
      'topic-a',
      expect.objectContaining({
        executionConfig: expect.objectContaining({ boundDeviceId: 'device-a' }),
      }),
    );
  });
  it('creates a Topic for an explicit choice in the empty composer', async () => {
    state.chat.activeTopicId = undefined;
    const { result } = renderHook(() => useSelectExecutionTarget('agent'));
    await result.current('none');
    expect(state.chat.updateTopicMetadata).toHaveBeenCalledWith('new-topic', expect.anything());
    expect(state.chat.switchTopic).toHaveBeenCalledWith('new-topic');
  });
  it('does not create a Topic for automatic defaults or bypass fixed policy', async () => {
    state.chat.activeTopicId = undefined;
    const { result } = renderHook(() => useSelectExecutionTarget('agent'));
    await result.current('local', undefined, { silent: true });
    state.config.canSelectExecutionTarget = false;
    const fixed = renderHook(() => useSelectExecutionTarget('agent'));
    await fixed.result.current('sandbox');
    expect(state.chat.createTopic).not.toHaveBeenCalled();
    expect(state.chat.updateTopicMetadata).not.toHaveBeenCalled();
  });
  it('surfaces a failed save without navigating to another topic', async () => {
    state.chat.updateTopicMetadata.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useSelectExecutionTarget('agent'));
    await result.current('sandbox');
    expect(state.toast).toHaveBeenCalled();
    expect(state.chat.switchTopic).not.toHaveBeenCalled();
  });
});

it('does not reparent another Topic messages after leaving an empty composer', async () => {
  state.chat.activeTopicId = undefined;
  state.chat.activeAgentId = 'agent';
  state.config.canSelectExecutionTarget = true;
  state.chat.createTopic.mockClear();
  let resolve!: (value: { deviceId: string }) => void;
  state.deviceInfo.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { result } = renderHook(() => useSelectExecutionTarget('agent'));
  const selection = result.current('local');
  state.chat.activeTopicId = 'topic-b';
  resolve({ deviceId: 'device-a' });
  await selection;
  expect(state.chat.createTopic).not.toHaveBeenCalled();
});
