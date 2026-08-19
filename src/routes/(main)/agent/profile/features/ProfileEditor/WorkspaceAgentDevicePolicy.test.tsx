import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspaceAgentDevicePolicy from './WorkspaceAgentDevicePolicy';

const testState = vi.hoisted(() => ({
  agent: {
    agentMap: {
      'agent-1': {
        agencyConfig: {
          executionTarget: 'auto' as string,
          executionTargetSelectionPolicy: 'member' as string,
          heterogeneousProvider: undefined as { type: string } | undefined,
        },
        visibility: 'public' as 'private' | 'public',
        workspaceId: 'workspace-1',
      },
    },
    updateAgentConfigById: vi.fn(),
  },
  devices: undefined as unknown,
  mutateDevices: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Select: ({
    disabled,
    loading,
    options,
    popupMatchSelectWidth,
  }: {
    disabled?: boolean;
    loading?: boolean;
    options?: Array<{
      disabled?: boolean;
      options?: Array<{ disabled?: boolean; value: string }>;
      value?: string;
    }>;
    popupMatchSelectWidth?: boolean | number;
  }) => {
    const deviceOptions = (options ?? []).flatMap((option) =>
      'options' in option && option.options ? option.options : [option],
    );
    return (
      <button
        data-popup-match-select-width={String(popupMatchSelectWidth)}
        disabled={disabled || loading}
        role="combobox"
        data-disabled-device-values={deviceOptions
          .filter((option) => option.disabled)
          .map((option) => option.value)
          .join(',')}
      />
    );
  },
}));

vi.mock('@/features/DeviceManager/useDeviceList', () => ({
  useDeviceList: () => ({
    data: testState.devices,
    error: undefined,
    isLoading: false,
    mutate: testState.mutateDevices,
  }),
}));

vi.mock('@/features/DeviceManager/useDeviceAgentScan', () => ({
  useDeviceAgentScans: (deviceIds: string[] | undefined) => {
    const scanMap: Record<string, { available: boolean } | undefined> = {};
    const scannedMap: Record<string, boolean> = {};
    for (const deviceId of deviceIds ?? []) {
      if (deviceId === 'device-scan-failed') continue;
      scannedMap[deviceId] = true;
      // 'device-no-cli' explicitly reports unavailable; 'device-legacy'
      // answered the scan but its map lacks the agent type (old client).
      scanMap[deviceId] =
        deviceId === 'device-no-cli'
          ? { available: false }
          : deviceId === 'device-legacy'
            ? undefined
            : { available: true };
    }
    return {
      error: undefined,
      isLoading: false,
      isValidating: false,
      revalidate: vi.fn(),
      scanMap,
      scannedMap,
    };
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof testState.agent) => unknown) =>
    selector(testState.agent),
}));

describe('WorkspaceAgentDevicePolicy', () => {
  beforeEach(() => {
    testState.agent.agentMap['agent-1'].visibility = 'public';
    testState.agent.agentMap['agent-1'].agencyConfig = {
      executionTarget: 'auto',
      executionTargetSelectionPolicy: 'member',
      heterogeneousProvider: undefined,
    };
    testState.devices = undefined;
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

  it('disables device options whose CLI is not detected', () => {
    testState.agent.agentMap['agent-1'].agencyConfig = {
      executionTarget: 'device',
      executionTargetSelectionPolicy: 'member',
      heterogeneousProvider: { type: 'claude-code' },
    };
    testState.devices = [
      {
        deviceId: 'device-no-cli',
        hostname: 'old-box',
        online: true,
        scope: 'workspace',
        visibility: 'public',
      },
      {
        // Client predates the agent type: scan succeeded, type absent.
        deviceId: 'device-legacy',
        hostname: 'legacy-box',
        online: true,
        scope: 'workspace',
        visibility: 'public',
      },
      {
        deviceId: 'device-scan-failed',
        hostname: 'probe-down',
        online: true,
        scope: 'workspace',
        visibility: 'public',
      },
      {
        deviceId: 'device-with-cli',
        hostname: 'dev-box',
        online: true,
        scope: 'workspace',
        visibility: 'public',
      },
    ];

    render(<WorkspaceAgentDevicePolicy agentId="agent-1" />);

    const select = screen.getByRole('combobox') as HTMLButtonElement;
    // Missing CLI and type-absent (old client) options are disabled; a failed
    // probe and a working device stay enabled.
    expect(select.dataset.disabledDeviceValues).toBe('device:device-no-cli,device:device-legacy');
  });
});
