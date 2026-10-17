import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicAwareTargetSelect } from './useTopicAwareTargetSelect';

const state = vi.hoisted(() => ({
  activeTopicId: undefined as string | undefined,
  confirmModal: vi.fn(),
  selectExecutionTarget: vi.fn(),
  topics: {} as Record<string, { boundDeviceId?: string }>,
  updateTopicMetadata: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  confirmModal: state.confirmModal,
  toast: { error: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useEffectiveWorkingDirectory', () => ({
  useEffectiveWorkingDirectory: () => '/repo',
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: { ensureSandboxWorkspace: vi.fn() },
}));

vi.mock('./useCommitWorkingDirectory', () => ({
  useCommitWorkingDirectory: () => ({ commit: vi.fn() }),
}));

// Store boundary: the real topic selectors run against this state.
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) =>
    selector({
      activeTopicId: state.activeTopicId,
      topicDataMap: {},
      topicDetailMap: Object.fromEntries(
        Object.entries(state.topics).map(([id, metadata]) => [
          id,
          { agentId: 'agent-1', id, metadata },
        ]),
      ),
      updateTopicMetadata: state.updateTopicMetadata,
    }),
}));

const devices = [
  { deviceId: 'device-a', friendlyName: 'Device A' },
  { deviceId: 'device-b', friendlyName: 'Device B' },
];

const renderSelect = (topicId: string | null) =>
  renderHook(() =>
    useTopicAwareTargetSelect({
      agentId: 'agent-1',
      devices,
      selectExecutionTarget: state.selectExecutionTarget,
      topicId,
    }),
  );

beforeEach(() => {
  // The main column's topic stays globally active while a side pane renders another.
  state.activeTopicId = 'main-topic';
  state.topics = {
    'main-topic': { boundDeviceId: 'device-b' },
    'pane-topic': { boundDeviceId: 'device-a' },
  };
  state.confirmModal.mockReset();
  state.selectExecutionTarget.mockReset().mockResolvedValue(true);
  state.updateTopicMetadata.mockReset().mockResolvedValue(undefined);
});

describe('useTopicAwareTargetSelect', () => {
  // Moving a topic drops its CLI session and cwd, so it must hit the given topic.
  it('moves the given topic to the picked device after confirmation', async () => {
    const { result } = renderSelect('pane-topic');

    expect(result.current.topicDeviceId).toBe('device-a');
    await act(() => result.current.selectTarget('device', 'device-b'));
    expect(state.confirmModal).toHaveBeenCalledTimes(1);

    await act(() => state.confirmModal.mock.calls[0][0].onOk());

    expect(state.updateTopicMetadata).toHaveBeenCalledTimes(1);
    expect(state.updateTopicMetadata).toHaveBeenCalledWith(
      'pane-topic',
      expect.objectContaining({ boundDeviceId: 'device-b', heteroSessionId: undefined }),
    );
    expect(state.selectExecutionTarget).toHaveBeenCalledWith('device', 'device-b', {
      localSandbox: undefined,
    });
  });

  it('switches the agent target without touching any topic when the conversation has none', async () => {
    const { result } = renderSelect(null);

    expect(result.current.topicDeviceId).toBeUndefined();
    await act(() => result.current.selectTarget('device', 'device-a'));

    expect(state.confirmModal).not.toHaveBeenCalled();
    expect(state.updateTopicMetadata).not.toHaveBeenCalled();
    expect(state.selectExecutionTarget).toHaveBeenCalledWith('device', 'device-a', {
      localSandbox: undefined,
    });
  });

  it('keeps the topic pin when the picked device is the one it already runs on', async () => {
    const { result } = renderSelect('pane-topic');

    await act(() => result.current.selectTarget('device', 'device-a'));

    expect(state.confirmModal).not.toHaveBeenCalled();
    expect(state.updateTopicMetadata).not.toHaveBeenCalled();
    expect(state.selectExecutionTarget).toHaveBeenCalledWith('device', 'device-a', {
      localSandbox: undefined,
    });
  });
});
