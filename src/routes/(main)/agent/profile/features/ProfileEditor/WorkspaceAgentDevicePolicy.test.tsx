import type * as BaseUI from '@lobehub/ui/base-ui';
import { act, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspaceAgentDevicePolicy from './WorkspaceAgentDevicePolicy';

const testState = vi.hoisted(() => ({
  agent: {
    agentMap: {
      'agent-1': {
        agencyConfig: {
          executionTarget: 'auto' as const,
          executionTargetSelectionPolicy: 'member' as const,
        },
        visibility: 'public' as 'private' | 'public',
        workspaceId: 'workspace-1',
      },
    },
    updateAgentConfigById: vi.fn(),
  },
  mutateDevices: vi.fn(),
}));

const selectPropsSpy = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof BaseUI>();
  const ActualSelect = actual.Select as ComponentType<Record<string, unknown>>;
  return {
    ...actual,
    Select: (props: Record<string, unknown>) => {
      selectPropsSpy(props);
      return <ActualSelect {...props} />;
    },
  };
});

vi.mock('@/features/DeviceManager/useDeviceList', () => ({
  useDeviceList: () => ({
    data: undefined,
    error: undefined,
    isLoading: true,
    mutate: testState.mutateDevices,
  }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof testState.agent) => unknown) =>
    selector(testState.agent),
}));

describe('WorkspaceAgentDevicePolicy', () => {
  beforeEach(() => {
    testState.agent.agentMap['agent-1'].visibility = 'public';
    testState.agent.updateAgentConfigById.mockReset();
    testState.mutateDevices.mockReset();
    selectPropsSpy.mockClear();
  });

  it('renders the environment picker without a member-switch control', () => {
    render(<WorkspaceAgentDevicePolicy agentId="agent-1" />);

    expect(screen.getByText('settingAgent.devicePolicy.title')).toBeTruthy();
    // Whether members may switch moved to the Agent's Permission page — the
    // card must not offer a second, competing control for the same setting.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: 'settingAgent.selectionPolicy.membersCanSwitch',
      }),
    ).toBeNull();
  });

  it('keeps the target picker interactive while a save is pending', async () => {
    let finishSave: (() => void) | undefined;
    testState.agent.updateAgentConfigById.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );

    render(<WorkspaceAgentDevicePolicy agentId="agent-1" />);

    expect(screen.queryByText('settingAgent.devicePolicy.defaultTarget')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();

    const selectProps = selectPropsSpy.mock.lastCall?.[0] as Record<string, unknown>;
    expect(selectProps.popupMatchSelectWidth).toBe(true);
    expect(selectProps.disabled).toBeFalsy();
    expect(selectProps.loading).toBeFalsy();

    await act(async () => finishSave?.());
  });
});
