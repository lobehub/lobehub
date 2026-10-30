import type { TaskExecutionConfig } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTaskExecutionSelection, useTaskExecutionSelection } from './useTaskExecutionSelection';

const DEVICE_AGENT = { deviceId: 'device-agent' };
const DEVICE_OTHER = { deviceId: 'device-other' };
const AGENT_DIRECTORY = { path: '/repos/lobehub', repoType: 'git' as const };

const mocks = vi.hoisted(() => ({
  target: {} as Record<string, unknown>,
}));

vi.mock('./useTaskRunTarget', () => ({
  useTaskRunTarget: (_agentId: string, pinnedDeviceId?: string) => ({
    ...mocks.target,
    deviceId: pinnedDeviceId ?? mocks.target.inheritedDeviceId,
  }),
}));

const deviceAgent = () => {
  mocks.target = {
    devices: [DEVICE_AGENT, DEVICE_OTHER],
    inheritedDeviceId: DEVICE_AGENT.deviceId,
    inheritedDirectory: AGENT_DIRECTORY,
  };
};

const cloudAgent = () => {
  mocks.target = { devices: [DEVICE_OTHER] };
};

const renderSelection = (value?: TaskExecutionConfig) => {
  const onChange = vi.fn();
  const hook = renderHook(
    ({ current }: { current?: TaskExecutionConfig }) =>
      useTaskExecutionSelection({ agentId: 'agent-1', onChange, value: current }),
    { initialProps: { current: value } },
  );
  return { onChange, ...hook };
};

beforeEach(() => {
  deviceAgent();
});

describe('useTaskExecutionSelection', () => {
  // The device and the directory used to carry a "Follow the agent" option each,
  // so a task could read as "this machine, the agent's folder" while both were
  // in fact the agent's. Following is one decision covering both axes.
  it('follows the agent while the task stores no selection', () => {
    expect(renderSelection().result.current.following).toBe(true);
  });

  it('is off the agent as soon as either axis belongs to the task', () => {
    expect(renderSelection({ boundDeviceId: DEVICE_OTHER.deviceId }).result.current.following).toBe(
      false,
    );
    expect(renderSelection({ repos: ['lobehub/lobehub'] }).result.current.following).toBe(false);
  });

  it('starts from the agent machine and folder when the task stops following', () => {
    const { onChange, result } = renderSelection();

    act(() => result.current.changeFollowing(false));

    expect(onChange).toHaveBeenLastCalledWith({
      boundDeviceId: DEVICE_AGENT.deviceId,
      repos: undefined,
      workingDirectory: AGENT_DIRECTORY.path,
      workingDirectoryConfig: AGENT_DIRECTORY,
    });
  });

  it('returns both axes to the agent when following is switched back on', () => {
    const { onChange, result } = renderSelection({
      boundDeviceId: DEVICE_OTHER.deviceId,
      workingDirectory: '/srv/app',
      workingDirectoryConfig: { path: '/srv/app' },
    });

    act(() => result.current.changeFollowing(true));

    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  // A cloud agent has no machine to start from, so nothing is stored yet — the
  // pickers must still open instead of snapping back to "follow".
  it('stays off the agent for a cloud agent that has nothing to seed', () => {
    cloudAgent();
    const { onChange, result } = renderSelection();

    act(() => result.current.changeFollowing(false));

    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(result.current.following).toBe(false);
  });

  it('stays off the agent when the only pin is removed', () => {
    cloudAgent();
    const { onChange, rerender, result } = renderSelection();

    act(() => result.current.changeFollowing(false));
    rerender({ current: { boundDeviceId: DEVICE_OTHER.deviceId } });
    act(() => result.current.changeDevice(undefined));
    rerender({ current: undefined });

    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(result.current.following).toBe(false);
  });

  it('pins the machine in force when a folder is picked', () => {
    const { onChange, result } = renderSelection({ boundDeviceId: DEVICE_OTHER.deviceId });

    act(() => result.current.changeDirectory({ path: '/srv/app' }));

    expect(onChange).toHaveBeenLastCalledWith({
      boundDeviceId: DEVICE_OTHER.deviceId,
      repos: undefined,
      workingDirectory: '/srv/app',
      workingDirectoryConfig: { path: '/srv/app' },
    });
  });
});

describe('seedTaskExecutionSelection', () => {
  it('pins the machine without a folder when the agent has none there', () => {
    expect(
      seedTaskExecutionSelection({
        devices: [DEVICE_AGENT] as never,
        inheritedDeviceId: DEVICE_AGENT.deviceId,
      }),
    ).toEqual({ boundDeviceId: DEVICE_AGENT.deviceId });
  });

  // A workspace task's runs cannot reach a member's private machine.
  it('pins nothing when the agent machine is outside the task pool', () => {
    expect(
      seedTaskExecutionSelection({
        devices: [DEVICE_OTHER] as never,
        inheritedDeviceId: DEVICE_AGENT.deviceId,
        inheritedDirectory: AGENT_DIRECTORY,
      }),
    ).toBeUndefined();
  });
});
