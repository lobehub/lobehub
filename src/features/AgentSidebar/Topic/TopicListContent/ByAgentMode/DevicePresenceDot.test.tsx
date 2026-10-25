/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DevicePresenceDot from './DevicePresenceDot';

const mocks = vi.hoisted(() => ({
  binding: undefined as string | null | undefined,
  confirmed: true,
  devices: undefined as Array<Record<string, unknown>> | undefined,
  useAgentDeviceBinding: vi.fn(),
}));

vi.mock('./useAgentDeviceBinding', () => ({
  useAgentDeviceBinding: (agentId: string) => {
    mocks.useAgentDeviceBinding(agentId);
    return { data: mocks.binding };
  },
}));

vi.mock('@/store/device', () => ({
  isDevicePresenceUnknown: (device: { onlineUnknown?: boolean }) => !!device.onlineUnknown,
  useDeviceList: () => ({ data: mocks.devices, isConfirmed: mocks.confirmed }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const dot = () => screen.queryByTestId('agent-device-presence');

describe('DevicePresenceDot', () => {
  beforeEach(() => {
    mocks.useAgentDeviceBinding.mockClear();
    mocks.binding = 'dev-1';
    mocks.confirmed = true;
    mocks.devices = [{ deviceId: 'dev-1', online: true }];
  });

  it('asks for the binding of the agent it decorates', () => {
    render(<DevicePresenceDot agentId="agt-1" />);

    expect(mocks.useAgentDeviceBinding).toHaveBeenCalledWith('agt-1');
  });

  it('shows an online dot when the device the agent routes to is online', () => {
    render(<DevicePresenceDot agentId="agt-1" />);

    expect(dot()?.dataset.online).toBe('true');
  });

  it('shows an offline dot when the device the agent routes to is offline', () => {
    mocks.devices = [{ deviceId: 'dev-1', online: false }];

    render(<DevicePresenceDot agentId="agt-1" />);

    expect(dot()?.dataset.online).toBe('false');
  });

  /** @example An agent moved from an offline device to the cloud sandbox is not gray. */
  it('defaults an agent that routes to no device to online', () => {
    // The server omits agents whose stored binding the execution target does not use.
    mocks.binding = null;
    mocks.devices = [{ deviceId: 'dev-1', online: false }];

    render(<DevicePresenceDot agentId="agt-1" />);

    expect(dot()?.dataset.online).toBe('true');
  });

  it('defaults to online when the routed device is absent from the caller-scoped list', () => {
    mocks.devices = [{ deviceId: 'other', online: false }];

    render(<DevicePresenceDot agentId="agt-1" />);

    expect(dot()?.dataset.online).toBe('true');
  });

  it('renders nothing until the binding is known', () => {
    mocks.binding = undefined;

    render(<DevicePresenceDot agentId="agt-1" />);

    expect(dot()).toBeNull();
  });

  it('renders nothing while the device list is only the persisted copy', () => {
    mocks.confirmed = false;

    render(<DevicePresenceDot agentId="agt-1" />);

    expect(dot()).toBeNull();
  });

  it('renders nothing while the device list is missing', () => {
    mocks.devices = undefined;

    render(<DevicePresenceDot agentId="agt-1" />);

    expect(dot()).toBeNull();
  });

  it('renders nothing when the routed device presence is still unknown', () => {
    mocks.devices = [{ deviceId: 'dev-1', online: false, onlineUnknown: true }];

    render(<DevicePresenceDot agentId="agt-1" />);

    expect(dot()).toBeNull();
  });
});
