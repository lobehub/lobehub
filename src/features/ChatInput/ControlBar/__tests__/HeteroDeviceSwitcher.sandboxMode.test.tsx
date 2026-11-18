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
    agencyConfig: { executionTarget: 'sandbox' },
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
const TEMPORARY = 'heteroAgent.executionTarget.temporarySandbox';
const PERSISTENT = 'heteroAgent.executionTarget.persistentSandbox';

beforeEach(() => {
  state.devices = [];
  state.driveStatus = 'ready';
  state.persistent = false;
  state.openUpsell.mockReset();
  state.selectTarget.mockReset().mockImplementation(async (...args: unknown[]) => {
    const afterApply = args[3] as (() => Promise<void>) | undefined;
    await afterApply?.();
  });
  state.toPersistent.mockReset().mockResolvedValue(undefined);
  state.toTemporary.mockReset().mockResolvedValue(undefined);
});

// T-14161: the persistent sandbox is a row of its own in the execution
// environment, not a folder picked after "Cloud sandbox".
describe('HeteroDeviceSwitcher — persistent sandbox', () => {
  it('offers the persistent sandbox next to the temporary one', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getAllByText(TEMPORARY).length).toBeGreaterThan(0);
    expect(screen.getByText('heteroAgent.executionTarget.persistentSandboxDesc')).toBeTruthy();
  });

  // Next to the persistent sandbox, the plain one is called the temporary
  // sandbox, on its row and on the chip.
  it('names the plain sandbox temporary next to the persistent one', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getByTestId('chip').textContent).toContain(TEMPORARY);
    expect(screen.queryByText(SANDBOX)).toBeNull();
  });

  // The persistent sandbox is where everyday work belongs, so it comes first;
  // the temporary one is described as the place for coding and one-off work.
  it('lists the persistent sandbox above the temporary one', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    const persistent = screen.getByText('heteroAgent.executionTarget.persistentSandboxDesc');
    const temporary = screen.getByText('heteroAgent.executionTarget.temporarySandboxDesc');

    expect(
      persistent.compareDocumentPosition(temporary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText('heteroAgent.executionTarget.sandboxDesc')).toBeNull();
  });

  it('describes the cloud sandbox as before where there is no drive at all', () => {
    state.driveStatus = 'hidden';
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getByText('heteroAgent.executionTarget.sandboxDesc')).toBeTruthy();
    expect(screen.queryByText('heteroAgent.executionTarget.temporarySandboxDesc')).toBeNull();
    expect(screen.getAllByText(SANDBOX).length).toBeGreaterThan(0);
    expect(screen.queryByText(TEMPORARY)).toBeNull();
  });

  it('names the persistent sandbox on the chip when the conversation keeps its files', () => {
    state.persistent = true;
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getByTestId('chip').textContent).toContain(PERSISTENT);
  });

  it('switches to the sandbox and onto the drive when the persistent row is picked', async () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    fireEvent.click(screen.getByText('heteroAgent.executionTarget.persistentSandboxDesc'));
    await vi.waitFor(() => expect(state.toPersistent).toHaveBeenCalledTimes(1));

    expect(state.selectTarget.mock.calls[0][0]).toBe('sandbox');
    expect(state.toTemporary).not.toHaveBeenCalled();
  });

  it('switches to the temporary sandbox from the plain row', async () => {
    state.persistent = true;
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    fireEvent.click(screen.getByText('heteroAgent.executionTarget.temporarySandboxDesc'));
    await vi.waitFor(() => expect(state.toTemporary).toHaveBeenCalledTimes(1));

    expect(state.selectTarget.mock.calls[0][0]).toBe('sandbox');
    expect(state.toPersistent).not.toHaveBeenCalled();
  });

  it('shows a plan without a drive the way to one instead', () => {
    state.driveStatus = 'upgrade';
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    fireEvent.click(screen.getByText('heteroAgent.executionTarget.persistentSandboxDesc'));

    expect(screen.getByText('pro')).toBeTruthy();
    expect(state.openUpsell).toHaveBeenCalledTimes(1);
    expect(state.selectTarget).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'loading'] as const)('hides the row while the drive is %s', (driveStatus) => {
    state.driveStatus = driveStatus;
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.queryByText(PERSISTENT)).toBeNull();
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
    const persistent = screen.getByText('heteroAgent.executionTarget.persistentSandboxDesc');

    expect(follows(builtin, auto)).toBe(true);
    expect(follows(auto, sandboxes)).toBe(true);
    expect(follows(sandboxes, persistent)).toBe(true);
  });

  it('leaves the sections unlabelled on web without devices', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.queryByText(BUILTIN)).toBeNull();
    expect(screen.queryByText(SANDBOXES)).toBeNull();
  });
});
