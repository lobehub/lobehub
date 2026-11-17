import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeteroDeviceSwitcher from '../HeteroDeviceSwitcher';

const state = vi.hoisted(() => ({
  devices: [] as object[],
  driveStatus: 'ready' as 'hidden' | 'loading' | 'ready' | 'upgrade',
  openUpsell: vi.fn(),
  persistent: false,
  selectTarget: vi.fn(),
  toPersistent: vi.fn(),
  target: 'sandbox' as string,
  toTemporary: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The menu, open: which rows it offers and what they do is the question.
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Popover: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <div>
      <div data-testid="chip">{children}</div>
      {content}
    </div>
  ),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDesktop: false,
}));

vi.mock('@/business/client/features/SandboxStorageUpsell', () => ({
  openSandboxStorageUpsell: state.openUpsell,
}));
vi.mock('@/features/ChatInput/hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({ canUseResource: true }),
}));
vi.mock('@/features/ChatInput/hooks/useLocalSandboxCapability', () => ({
  useLocalSandboxCapability: () => ({ data: undefined, mutate: vi.fn() }),
}));
vi.mock('@/features/ChatInput/hooks/useSelectExecutionTarget', () => ({
  useSelectExecutionTarget: () => vi.fn(),
}));
vi.mock('@/features/DeviceManager/DeviceLoadMeter', () => ({
  default: () => null,
  useDeviceLoad: () => null,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/helpers/gatewayMode', () => ({ useIsGatewayModeEnabled: () => false }));
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: { executionTarget: state.target },
    canDisplayExecutionTarget: true,
    canSelectExecutionTarget: true,
    isPreferenceLoading: false,
    topicDeviceUnknown: false,
    workspaceScoped: false,
  }),
}));
vi.mock('@/hooks/useLocalMachineDeviceIds', () => ({ useLocalMachineDeviceIds: () => [] }));
vi.mock('@/services/device', () => ({ deviceService: {} }));
vi.mock('@/services/electron/localFileService', () => ({ localFileService: {} }));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: object) => unknown) => selector({ agentMap: {} }),
}));
vi.mock('@/store/device', () => ({
  isDevicePresenceUnknown: () => false,
  useDeviceList: () => ({
    data: state.devices,
    error: undefined,
    isConfirmed: true,
    isValidating: false,
    mutate: vi.fn(),
  }),
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: object) => unknown) =>
    selector({ gatewayDeviceInfo: undefined, useFetchGatewayDeviceInfo: () => () => undefined }),
}));
vi.mock('../../hooks/useTopicId', () => ({ useTopicId: () => 'topic-1' }));
// A device group is one row here; its submenu has tests of its own.
vi.mock('../DeviceGroupSubmenu', () => ({
  default: ({ label }: { label: string }) => <div>{label}</div>,
}));
vi.mock('../useSandboxNetworkToggle', () => ({ useSandboxNetworkToggle: () => vi.fn() }));
vi.mock('../useTopicAwareTargetSelect', () => ({
  useTopicAwareTargetSelect: () => ({ selectTarget: state.selectTarget, topicDeviceId: undefined }),
}));
vi.mock('../useSandboxModeSelect', () => ({
  useSandboxModeSelect: () => ({
    driveStatus: state.driveStatus,
    persistent: state.persistent,
    toPersistent: state.toPersistent,
    toTemporary: state.toTemporary,
  }),
}));

const SANDBOX = 'heteroAgent.executionTarget.sandbox';
const SWITCH = 'heteroAgent.executionTarget.persistSwitch';
const TEMPORARY = 'heteroAgent.executionTarget.temporarySandbox';
const PERSISTENT = 'heteroAgent.executionTarget.persistentSandbox';

beforeEach(() => {
  state.devices = [];
  state.driveStatus = 'ready';
  state.persistent = false;
  state.target = 'sandbox';
  state.openUpsell.mockReset();
  state.selectTarget.mockReset().mockImplementation(async (...args: unknown[]) => {
    const afterApply = args[3] as (() => Promise<void>) | undefined;
    await afterApply?.();
  });
  state.toPersistent.mockReset().mockResolvedValue(undefined);
  state.toTemporary.mockReset().mockResolvedValue(undefined);
});

// One cloud sandbox in the execution environment; whether it keeps its files
// on the drive is a switch inside that row once it is picked.
describe('HeteroDeviceSwitcher — cloud sandbox persistence', () => {
  it('offers a single cloud sandbox row, not a persistent and a temporary one', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getAllByText(SANDBOX).length).toBeGreaterThan(0);
    expect(screen.queryByText(PERSISTENT)).toBeNull();
    expect(screen.queryByText(TEMPORARY)).toBeNull();
  });

  it('names the cloud sandbox on the chip, persistent or not', () => {
    state.persistent = true;
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getByTestId('chip').textContent).toContain(SANDBOX);
  });

  it('shows the persistence switch inside the picked sandbox row', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getByText(SWITCH)).toBeTruthy();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('heteroAgent.executionTarget.temporarySandboxDesc')).toBeTruthy();
  });

  it('reflects a conversation that keeps its files on the drive', () => {
    state.persistent = true;
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('heteroAgent.executionTarget.persistentSandboxDesc')).toBeTruthy();
  });

  it('hides the switch until the sandbox is the pick', () => {
    state.target = 'none';
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.queryByText(SWITCH)).toBeNull();
    expect(screen.getByText('heteroAgent.executionTarget.sandboxDesc')).toBeTruthy();
  });

  it('moves onto the drive when the switch is turned on, without re-picking the target', async () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    fireEvent.click(screen.getByRole('switch'));
    await vi.waitFor(() => expect(state.toPersistent).toHaveBeenCalledTimes(1));

    expect(state.toTemporary).not.toHaveBeenCalled();
    expect(state.selectTarget).not.toHaveBeenCalled();
  });

  it('leaves the drive when the switch is turned off', async () => {
    state.persistent = true;
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    fireEvent.click(screen.getByRole('switch'));
    await vi.waitFor(() => expect(state.toTemporary).toHaveBeenCalledTimes(1));

    expect(state.toPersistent).not.toHaveBeenCalled();
  });

  it('picks the sandbox target from the row and keeps the placement as it is', async () => {
    state.target = 'none';
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    fireEvent.click(screen.getByText('heteroAgent.executionTarget.sandboxDesc'));
    await vi.waitFor(() => expect(state.selectTarget).toHaveBeenCalledTimes(1));

    expect(state.selectTarget.mock.calls[0][0]).toBe('sandbox');
    expect(state.toPersistent).not.toHaveBeenCalled();
    expect(state.toTemporary).not.toHaveBeenCalled();
  });

  it('shows a plan without a drive the way to one instead', () => {
    state.driveStatus = 'upgrade';
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    fireEvent.click(screen.getByRole('switch'));

    expect(screen.getByText('pro')).toBeTruthy();
    expect(state.openUpsell).toHaveBeenCalledTimes(1);
    expect(state.toPersistent).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'loading'] as const)('has no switch while the drive is %s', (driveStatus) => {
    state.driveStatus = driveStatus;
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.queryByText(SWITCH)).toBeNull();
    expect(screen.getByText('heteroAgent.executionTarget.sandboxDesc')).toBeTruthy();
  });
});

// The sandboxes are a section of their own, apart from the built-in choices
// that run nowhere in particular (no device, auto).
describe('HeteroDeviceSwitcher — sections', () => {
  const BUILTIN = 'heteroAgent.executionTarget.builtinGroup';
  const SANDBOXES = 'heteroAgent.executionTarget.sandboxGroup';
  const follows = (a: Element, b: Element) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('puts the sandboxes under their own label, after no device and auto', () => {
    state.devices = [
      {
        channels: [],
        deviceId: 'd1',
        hostname: 'box',
        online: true,
        platform: 'linux',
        scope: 'personal',
      },
    ];
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    const builtin = screen.getByText(BUILTIN);
    const auto = screen.getByText('heteroAgent.executionTarget.autoDesc');
    const sandboxes = screen.getByText(SANDBOXES);
    const sandbox = screen.getByText('heteroAgent.executionTarget.temporarySandboxDesc');

    expect(follows(builtin, auto)).toBe(true);
    expect(follows(auto, sandboxes)).toBe(true);
    expect(follows(sandboxes, sandbox)).toBe(true);
  });

  it('leaves the sections unlabelled on web without devices', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.queryByText(BUILTIN)).toBeNull();
    expect(screen.queryByText(SANDBOXES)).toBeNull();
  });
});
