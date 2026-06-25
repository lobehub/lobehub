import type { DeviceListItem } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DeviceManager from './DeviceManager';

const mocks = vi.hoisted(() => ({
  electronState: {
    gatewayDeviceInfo: undefined as { deviceId: string } | undefined,
    useFetchGatewayDeviceInfo: vi.fn(),
  },
  isDesktop: false,
  swrState: {
    data: [] as DeviceListItem[] | undefined,
    isLoading: false,
  },
  useClientDataSWR: vi.fn(),
  userState: {
    isLogin: true,
  },
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return mocks.isDesktop;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Flexbox: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  Icon: () => <span data-testid="icon" />,
  Skeleton: () => <div data-testid="skeleton" />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: (factory: (context: { css: () => string }) => Record<string, string>) => {
    const rawStyles = factory({ css: () => 'className' });
    return Object.fromEntries(Object.keys(rawStyles).map((key) => [key, key]));
  },
  cssVar: new Proxy({}, { get: (_target, key) => `var(--${String(key)})` }),
}));

vi.mock('lucide-react', () => {
  const StubIcon = () => null;
  return {
    ChevronRightIcon: StubIcon,
    FolderCogIcon: StubIcon,
    MonitorDownIcon: StubIcon,
    MonitorUpIcon: StubIcon,
    ServerIcon: StubIcon,
    ShieldCheckIcon: StubIcon,
    TerminalIcon: StubIcon,
  };
});

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (...args: unknown[]) => mocks.useClientDataSWR(...args),
}));

vi.mock('@/services/device', () => ({
  deviceService: {
    listDevices: vi.fn(),
  },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: typeof mocks.electronState) => unknown) =>
    selector(mocks.electronState),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof mocks.userState) => unknown) => selector(mocks.userState),
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    isLogin: (state: typeof mocks.userState) => state.isLogin,
  },
}));

vi.mock('./DeviceDetailPanel', () => ({
  default: ({
    device,
    isCurrent,
    onClose,
  }: {
    device: DeviceListItem;
    isCurrent?: boolean;
    onClose: () => void;
  }) => (
    <section data-current={String(!!isCurrent)} data-testid="device-detail">
      detail:{device.deviceId}
      <button type="button" onClick={onClose}>
        close
      </button>
    </section>
  ),
}));

vi.mock('./DeviceItem', () => ({
  default: ({
    device,
    isCurrent,
    onSelect,
    selected,
  }: {
    device: DeviceListItem;
    isCurrent?: boolean;
    onSelect: () => void;
    selected?: boolean;
  }) => (
    <button
      data-current={String(!!isCurrent)}
      data-selected={String(!!selected)}
      data-testid={`device-item-${device.deviceId}`}
      type="button"
      onClick={onSelect}
    >
      device:{device.deviceId}
    </button>
  ),
}));

const createDevice = (
  deviceId: string,
  scope: DeviceListItem['scope'],
  overrides: Partial<DeviceListItem> = {},
): DeviceListItem => ({
  channels: [],
  defaultCwd: null,
  deviceId,
  friendlyName: null,
  hostname: `${deviceId}.local`,
  identitySource: null,
  lastSeen: '2026-06-22T00:00:00.000Z',
  online: false,
  platform: 'darwin',
  registered: true,
  scope,
  workingDirs: [],
  ...overrides,
});

beforeEach(() => {
  mocks.isDesktop = false;
  mocks.userState.isLogin = true;
  mocks.electronState.gatewayDeviceInfo = undefined;
  mocks.electronState.useFetchGatewayDeviceInfo.mockClear();
  mocks.swrState.data = [];
  mocks.swrState.isLoading = false;
  mocks.useClientDataSWR.mockImplementation(() => ({
    data: mocks.swrState.data,
    isLoading: mocks.swrState.isLoading,
  }));
});

describe('<DeviceManager />', () => {
  it('shows a skeleton while devices are loading', () => {
    mocks.swrState.isLoading = true;

    render(<DeviceManager scope="personal" onConnect={vi.fn()} />);

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('renders personal empty state with Desktop and CLI connect options', () => {
    const onConnect = vi.fn();

    render(<DeviceManager scope="personal" onConnect={onConnect} />);

    expect(screen.getByText('devices.empty.title')).toBeInTheDocument();
    expect(screen.getByText('devices.empty.methodDesktop.title')).toBeInTheDocument();
    expect(screen.getByText('devices.empty.methodCli.title')).toBeInTheDocument();

    fireEvent.click(screen.getByText('devices.empty.methodDesktop.title'));
    fireEvent.click(screen.getByText('devices.empty.methodCli.title'));

    expect(onConnect).toHaveBeenNthCalledWith(1, 'desktop');
    expect(onConnect).toHaveBeenNthCalledWith(2, 'cli');
  });

  it('renders workspace empty state with CLI enrollment only', () => {
    const onConnect = vi.fn();

    render(<DeviceManager scope="workspace" onConnect={onConnect} />);

    expect(screen.getByText('workspaceSetting.devices.heroTitle')).toBeInTheDocument();
    expect(screen.queryByText('devices.empty.methodDesktop.title')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('devices.empty.methodCli.title'));

    expect(onConnect).toHaveBeenCalledWith('cli');
  });

  it('uses a null SWR key when a web user is signed out', () => {
    mocks.userState.isLogin = false;

    render(<DeviceManager scope="personal" onConnect={vi.fn()} />);

    expect(mocks.useClientDataSWR).toHaveBeenCalledWith(null, expect.any(Function));
  });

  it('filters by personal scope and auto-selects the current desktop device', () => {
    mocks.isDesktop = true;
    mocks.electronState.gatewayDeviceInfo = { deviceId: 'personal-a' };
    mocks.swrState.data = [
      createDevice('personal-a', 'personal'),
      createDevice('workspace-a', 'workspace'),
    ];

    render(<DeviceManager scope="personal" onConnect={vi.fn()} />);

    expect(screen.getByText('devices.overview.personal.title')).toBeInTheDocument();
    expect(screen.getByText('devices.security.personal.metadata')).toBeInTheDocument();
    expect(screen.getByTestId('device-item-personal-a')).toHaveAttribute('data-current', 'true');
    expect(screen.queryByTestId('device-item-workspace-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('device-detail')).toHaveTextContent('detail:personal-a');
    expect(screen.getByTestId('device-detail')).toHaveAttribute('data-current', 'true');
  });

  it('shows placeholder for multiple devices until the user selects one', () => {
    const onConnect = vi.fn();
    mocks.swrState.data = [
      createDevice('personal-a', 'personal'),
      createDevice('personal-b', 'personal'),
    ];

    render(<DeviceManager scope="personal" onConnect={onConnect} />);

    expect(screen.getByText((content) => content.includes('tab.devices'))).toBeInTheDocument();
    expect(screen.getByText('devices.placeholder.title')).toBeInTheDocument();

    fireEvent.click(screen.getByText('devices.actions.connectAnother'));
    expect(onConnect).toHaveBeenCalledWith();

    fireEvent.click(screen.getByTestId('device-item-personal-a'));
    expect(screen.getByTestId('device-detail')).toHaveTextContent('detail:personal-a');

    fireEvent.click(screen.getByTestId('device-item-personal-a'));
    expect(screen.getByText('devices.placeholder.title')).toBeInTheDocument();
  });

  it('auto-selects a single workspace device and renders workspace security copy', () => {
    mocks.swrState.data = [createDevice('workspace-a', 'workspace')];

    render(<DeviceManager scope="workspace" onConnect={vi.fn()} />);

    expect(screen.getByText('devices.overview.workspace.title')).toBeInTheDocument();
    expect(screen.getByText('devices.security.workspace.members')).toBeInTheDocument();
    expect(screen.getByTestId('device-detail')).toHaveTextContent('detail:workspace-a');
    expect(screen.getByTestId('device-detail')).toHaveAttribute('data-current', 'false');
  });
});
