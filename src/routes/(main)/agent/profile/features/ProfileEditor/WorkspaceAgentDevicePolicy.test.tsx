import type * as BaseUI from '@lobehub/ui';
import { act, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspaceAgentDevicePolicy from './WorkspaceAgentDevicePolicy';

const testState = vi.hoisted(() => ({
  agent: {
    agentMap: {
      'agent-1': {
        agencyConfig: {
          executionTarget: 'auto',
          executionTargetSelectionPolicy: 'member',
        } as {
          boundDeviceId?: string;
          executionTarget: string;
          executionTargetSelectionPolicy: string;
        },
        visibility: 'public' as 'private' | 'public',
        workspaceId: 'workspace-1',
      },
    },
    updateAgentConfigById: vi.fn(),
  },
  deviceList: {
    data: undefined as unknown[] | undefined,
    isConfirmed: false,
    isLoading: true,
  },
  mutateDevices: vi.fn(),
}));

const selectPropsSpy = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => {
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

vi.mock('@/store/device/useDeviceList', () => ({
  useDeviceList: () => ({
    ...testState.deviceList,
    error: undefined,
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
    testState.deviceList = { data: undefined, isConfirmed: false, isLoading: true };
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

describe('WorkspaceAgentDevicePolicy over an unconfirmed device list', () => {
  const workspaceDevice = {
    channels: [],
    deviceId: 'ws-device',
    friendlyName: 'Build Server',
    online: false,
    onlineUnknown: true,
    scope: 'workspace',
    visibility: 'public',
  };

  const workspaceGroup = () => {
    const options = (selectPropsSpy.mock.lastCall?.[0] as { options: unknown[] }).options as {
      options?: { disabled?: boolean; value: string }[];
    }[];
    return options.find((option) => option.options)?.options ?? [];
  };

  beforeEach(() => {
    selectPropsSpy.mockClear();
  });

  it('shows stored workspace devices but does not let them be bound yet', () => {
    testState.deviceList = { data: [workspaceDevice], isConfirmed: false, isLoading: false };

    render(<WorkspaceAgentDevicePolicy agentId="agent-1" />);

    const [option] = workspaceGroup();
    expect(option.value).toContain('ws-device');
    expect(option.disabled).toBe(true);
  });

  it('reads a stored copy without workspace devices as loading, not empty', () => {
    testState.deviceList = { data: [], isConfirmed: false, isLoading: false };

    render(<WorkspaceAgentDevicePolicy agentId="agent-1" />);

    expect(workspaceGroup().map((option) => option.value)).toEqual(['status:loading']);
  });

  it('lets a confirmed device be bound', () => {
    testState.deviceList = {
      data: [{ ...workspaceDevice, onlineUnknown: undefined }],
      isConfirmed: true,
      isLoading: false,
    };

    render(<WorkspaceAgentDevicePolicy agentId="agent-1" />);

    expect(workspaceGroup()[0].disabled).toBeFalsy();
  });
});

describe('WorkspaceAgentDevicePolicy with a private workspace device', () => {
  const privateDevice = {
    channels: [],
    deviceId: 'private-device',
    friendlyName: 'My Laptop',
    online: true,
    scope: 'workspace',
    visibility: 'private',
  };

  const privateGroupOptions = () => {
    const options = (selectPropsSpy.mock.lastCall?.[0] as { options: unknown[] }).options as {
      options?: { disabled?: boolean; value: string }[];
    }[];
    return (
      options.find((group) =>
        group.options?.some((option) => option.value.includes('private-device')),
      )?.options ?? []
    );
  };

  const deviceOption = () =>
    privateGroupOptions().find((option) => option.value.includes('private-device'));

  beforeEach(() => {
    selectPropsSpy.mockClear();
    testState.agent.updateAgentConfigById.mockReset();
    testState.agent.agentMap['agent-1'].agencyConfig = {
      executionTarget: 'auto',
      executionTargetSelectionPolicy: 'member',
    };
    testState.deviceList = { data: [privateDevice], isConfirmed: true, isLoading: false };
  });

  it("lets a private agent's owner bind their own private device", () => {
    testState.agent.agentMap['agent-1'].visibility = 'private';

    render(<WorkspaceAgentDevicePolicy agentId="agent-1" />);

    const option = deviceOption();
    expect(option?.disabled).toBeFalsy();

    const { onChange } = selectPropsSpy.mock.lastCall?.[0] as { onChange: (v: string) => void };
    onChange(option!.value);
    expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-1', {
      agencyConfig: { boundDeviceId: 'private-device', executionTarget: 'device' },
    });
  });

  it('keeps private devices unselectable on a public agent and says why', () => {
    testState.agent.agentMap['agent-1'].visibility = 'public';

    render(<WorkspaceAgentDevicePolicy agentId="agent-1" />);

    expect(deviceOption()?.disabled).toBe(true);
    expect(privateGroupOptions().map((option) => option.value)).toContain(
      'status:privateUnavailable',
    );
  });

  it('keeps private devices unselectable once the environment is fixed', () => {
    testState.agent.agentMap['agent-1'].visibility = 'private';
    testState.agent.agentMap['agent-1'].agencyConfig = {
      executionTarget: 'auto',
      executionTargetSelectionPolicy: 'fixed',
    };

    render(<WorkspaceAgentDevicePolicy agentId="agent-1" />);

    expect(deviceOption()?.disabled).toBe(true);
    expect(privateGroupOptions().map((option) => option.value)).toContain(
      'status:privateUnavailable',
    );
  });

  it('shows an already-bound private device as the current selection', () => {
    testState.agent.agentMap['agent-1'].visibility = 'private';
    testState.agent.agentMap['agent-1'].agencyConfig = {
      boundDeviceId: 'private-device',
      executionTarget: 'device',
      executionTargetSelectionPolicy: 'member',
    };

    render(<WorkspaceAgentDevicePolicy agentId="agent-1" />);

    const { value } = selectPropsSpy.mock.lastCall?.[0] as { value?: string };
    expect(value).toContain('private-device');
    expect(value).toBe(deviceOption()?.value);
  });
});
