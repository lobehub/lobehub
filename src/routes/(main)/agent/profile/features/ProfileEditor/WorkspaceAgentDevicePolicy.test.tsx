import { act, render, screen } from '@testing-library/react';
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Select: ({
    disabled,
    loading,
    popupMatchSelectWidth,
  }: {
    disabled?: boolean;
    loading?: boolean;
    popupMatchSelectWidth?: boolean | number;
  }) => (
    <button
      data-popup-match-select-width={String(popupMatchSelectWidth)}
      disabled={disabled || loading}
      role="combobox"
    />
  ),
}));

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

vi.mock('@/store/agent/projection', () => ({
  useAgentData: (agentId: string) =>
    testState.agent.agentMap[agentId as keyof typeof testState.agent.agentMap],
}));

describe('WorkspaceAgentDevicePolicy', () => {
  beforeEach(() => {
    testState.agent.agentMap['agent-1'].visibility = 'public';
    testState.agent.updateAgentConfigById.mockReset();
    testState.mutateDevices.mockReset();
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

    const select = screen.getByRole('combobox') as HTMLButtonElement;
    expect(select.disabled).toBe(false);
    expect(select.dataset.popupMatchSelectWidth).toBe('true');

    await act(async () => finishSave?.());
  });
});
