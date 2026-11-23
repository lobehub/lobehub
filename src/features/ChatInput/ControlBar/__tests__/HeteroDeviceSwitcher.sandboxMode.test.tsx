import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeteroDeviceSwitcher from '../HeteroDeviceSwitcher';

const state = vi.hoisted(() => ({
  devices: [] as object[],
  selectTarget: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The menu, open: which rows it offers and what they do is the question. The
// first `chip` is the composer's.
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
vi.mock('../useSandboxOptions', () => ({ useSandboxOptions: () => ({}) }));
// The options are covered by their own tests; here one stands in for any pick.
vi.mock('../CloudSandboxOptions', () => ({
  default: ({ onEnsureSandbox }: { onEnsureSandbox: () => Promise<void> }) => (
    <button onClick={() => void onEnsureSandbox()}>pick-option</button>
  ),
}));

const SANDBOX = 'heteroAgent.executionTarget.sandbox';

beforeEach(() => {
  state.devices = [];
  state.selectTarget.mockReset().mockResolvedValue(undefined);
});

// T-14791: one cloud sandbox. Whether it keeps files on the drive and what it
// is set up from are options below the input, not rows of this menu.
describe('HeteroDeviceSwitcher — cloud sandbox', () => {
  it('names only the cloud sandbox on the chip and offers it as one row', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getAllByTestId('chip')[0].textContent).toBe(SANDBOX);
    expect(screen.getByTestId('cloud-sandbox-row')).toBeInTheDocument();
    expect(screen.queryByText('heteroAgent.executionTarget.persistentSandbox')).toBeNull();
    expect(screen.queryByText('heteroAgent.executionTarget.temporarySandbox')).toBeNull();
    expect(screen.queryByTestId('sandbox-group')).toBeNull();
  });

  // Its options live one level down; picking one is picking the sandbox.
  it('keeps a conversation already in the cloud sandbox where it is when an option is picked', async () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    fireEvent.click(screen.getByText('pick-option'));
    await Promise.resolve();

    expect(state.selectTarget).not.toHaveBeenCalled();
  });
});

// T-14345: the first level is a plain list of titles, without section labels
// or descriptions.
describe('HeteroDeviceSwitcher — first level', () => {
  const follows = (a: Element, b: Element) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  beforeEach(() => {
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
  });

  it('has no section labels', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.queryByText('heteroAgent.executionTarget.builtinGroup')).toBeNull();
    expect(screen.queryByText('heteroAgent.executionTarget.devicesGroup')).toBeNull();
  });

  it('shows the first-level rows by title only', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getByText('heteroAgent.executionTarget.none')).toBeTruthy();
    expect(screen.getByText('heteroAgent.executionTarget.auto')).toBeTruthy();
    expect(screen.queryByText('heteroAgent.executionTarget.noneDesc')).toBeNull();
    expect(screen.queryByText('heteroAgent.executionTarget.autoDesc')).toBeNull();
    expect(screen.queryByText('heteroAgent.executionTarget.sandboxDesc')).toBeNull();
  });

  it('lists the cloud sandbox after auto and before the device groups', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    const auto = screen.getByText('heteroAgent.executionTarget.auto');
    const sandbox = screen.getAllByText(SANDBOX).at(-1)!;
    const devices = screen.getByText('heteroAgent.executionTarget.myDevicesGroup');
    expect(follows(auto, sandbox)).toBe(true);
    expect(follows(sandbox, devices)).toBe(true);
  });
});
