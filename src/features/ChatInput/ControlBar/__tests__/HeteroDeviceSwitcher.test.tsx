import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeteroDeviceSwitcher from '../HeteroDeviceSwitcher';

const testState = vi.hoisted(() => ({
  agencyConfig: {
    heterogeneousProvider: { type: 'claude-code' as const },
  } as Record<string, unknown> | undefined,
  devices: undefined as unknown,
  gatewayDeviceInfo: undefined as { deviceId: string } | undefined,
  isDesktop: false,
  localStatus: undefined as { available: boolean } | undefined,
  navigate: vi.fn(),
  // deviceId → scan verdict; devices absent from the map but marked `scanned`
  // simulate an older device client that predates the agent type.
  scanResults: {} as Record<string, { available: boolean; version?: string } | undefined>,
  scanned: {} as Record<string, boolean>,
  sandboxAvailable: false,
  selectExecutionTarget: vi.fn(),
}));

vi.mock('@lobechat/const', () => ({
  DEFAULT_MODEL: 'gpt-4o',
  DEFAULT_PROVIDER: 'openai',
  get isDesktop() {
    return testState.isDesktop;
  },
}));

vi.mock('@lobechat/heterogeneous-agents', () => ({
  HETEROGENEOUS_TYPE_LABELS: { 'claude-code': 'Claude Code' },
}));

// Mock the client registry as well: its real implementation pulls in
// `@lobehub/icons` → `@lobehub/ui/icons` (a subpath the `@lobehub/ui` mock
// does not cover), whose icons module imports `createLucideIcon` from
// `lucide-react` — missing from the lucide mock below and fatal on CI's
// freshly resolved dependency versions.
vi.mock('@lobechat/heterogeneous-agents/client', () => ({
  getHeterogeneousAgentClientConfig: (type: string) => ({
    defaultCommand: type === 'claude-code' ? 'claude' : '',
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Icon: () => <span>Icon</span>,
  Popover: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
    <div>
      {children}
      {content}
    </div>
  ),
  Tooltip: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({}),
  cssVar: new Proxy({}, { get: () => 'var(--x)' }),
  cx: (...args: unknown[]) => args.filter(Boolean).join(' '),
  keyframes: () => '',
}));

vi.mock('lucide-react', () => ({
  CheckIcon: () => null,
  ChevronDownIcon: () => null,
  ExternalLinkIcon: () => null,
  InfoIcon: () => null,
  MonitorDownIcon: () => null,
  SettingsIcon: () => null,
  ShieldCheckIcon: () => null,
  // Defense in depth: any real icons module that reaches `lucide-react`
  // (e.g. `@lobehub/ui/icons` on newer dependency versions) needs this.
  createLucideIcon: () => () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/InstantSwitch', () => ({ default: () => null }));

vi.mock('@/const/url', () => ({
  DOWNLOAD_URL: { default: 'https://example.com/download' },
  OFFICIAL_SITE: 'https://lobehub.com',
}));

vi.mock('@/features/ChatInput/hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({ canUseResource: true }),
}));

vi.mock('@/features/ChatInput/hooks/useLocalSandboxCapability', () => ({
  useLocalSandboxCapability: () => ({
    data: testState.sandboxAvailable ? { available: true } : undefined,
    mutate: vi.fn(),
  }),
}));

vi.mock('@/features/ChatInput/hooks/useSelectExecutionTarget', () => ({
  useSelectExecutionTarget: () => testState.selectExecutionTarget,
}));

vi.mock('@/features/DeviceManager/useDeviceAgentScan', () => ({
  useDeviceAgentScan: (deviceId: string | undefined) => ({
    data: deviceId ? testState.scanResults[deviceId] : undefined,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
    scanned: deviceId ? (testState.scanned[deviceId] ?? false) : false,
  }),
}));

vi.mock('@/features/DeviceManager/useLocalHeteroAgentStatus', () => ({
  useLocalHeteroAgentStatus: (agentType: string | undefined) => ({
    auth: null,
    detecting: false,
    redetect: vi.fn(),
    status: agentType ? testState.localStatus : undefined,
  }),
}));

vi.mock('@/features/DeviceManager/useDeviceList', () => ({
  useDeviceList: () => ({ data: testState.devices, isLoading: false }),
}));

vi.mock('@/features/ExecutionTargetPicker', () => ({
  ExecutionTargetDeviceStatus: () => <span>Online</span>,
  ExecutionTargetIcon: () => <span>DeviceIcon</span>,
  groupExecutionTargetDevices: (devices: Array<{ scope: string }> | undefined) => ({
    personal: (devices ?? []).filter((device) => device.scope === 'personal'),
    privateWorkspace: [],
    publicWorkspace: [],
    workspace: [],
  }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => testState.navigate,
}));

vi.mock('@/helpers/executionTarget', () => ({
  isHeterogeneousSandboxExecutionAvailable: () => false,
  isLocalSandboxEnabled: () => false,
  resolveExecutionTarget: () => 'none' as const,
}));

vi.mock('@/helpers/gatewayMode', () => ({
  useIsGatewayModeEnabled: () => true,
}));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: testState.agencyConfig,
    canDisplayExecutionTarget: true,
    canSelectExecutionTarget: true,
    isPreferenceLoading: false,
    workspaceScoped: false,
  }),
}));

vi.mock('@/hooks/useEffectiveWorkingDirectory', () => ({
  useEffectiveWorkingDirectory: () => '',
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: {
    ensureSandboxWorkspace: vi.fn(),
    installSandbox: vi.fn(),
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { agentMap: object }) => unknown) => selector({ agentMap: {} }),
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (
    selector: (state: {
      gatewayDeviceInfo: unknown;
      useFetchGatewayDeviceInfo: unknown;
    }) => unknown,
  ) =>
    selector({
      gatewayDeviceInfo: testState.gatewayDeviceInfo,
      useFetchGatewayDeviceInfo: () => ({}),
    }),
}));

vi.mock('@/features/ChatInput/ControlBar/useCommitWorkingDirectory', () => ({
  useCommitWorkingDirectory: () => ({ commit: vi.fn() }),
}));

describe('HeteroDeviceSwitcher', () => {
  beforeEach(() => {
    testState.isDesktop = false;
    testState.gatewayDeviceInfo = undefined;
    testState.localStatus = undefined;
    testState.devices = [
      {
        deviceId: 'device-no-cli',
        friendlyName: 'No CLI Box',
        hostname: 'no-cli-box',
        online: true,
        platform: 'linux',
        scope: 'personal',
      },
      {
        deviceId: 'device-with-cli',
        friendlyName: 'Dev Box',
        hostname: 'dev-box',
        online: true,
        platform: 'darwin',
        scope: 'personal',
      },
    ];
    testState.scanResults = {
      'device-no-cli': { available: false },
      'device-with-cli': { available: true, version: '1.0.0' },
    };
    testState.scanned = {
      'device-no-cli': true,
      'device-with-cli': true,
    };
    testState.sandboxAvailable = false;
    testState.selectExecutionTarget.mockReset();
  });

  it('disables a device row when the CLI is not detected on it', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    // The unavailable device explains why it cannot be picked.
    expect(screen.getByText('heteroAgent.executionTarget.cliNotInstalled')).toBeInTheDocument();

    // Clicking the row without the CLI must not select it…
    fireEvent.click(screen.getByText('No CLI Box'));
    expect(testState.selectExecutionTarget).not.toHaveBeenCalled();

    // …while the device that has the CLI stays selectable.
    fireEvent.click(screen.getByText('Dev Box'));
    expect(testState.selectExecutionTarget).toHaveBeenCalledWith(
      'device',
      'device-with-cli',
      expect.anything(),
    );
  });

  it('disables a device row whose client predates the agent type', () => {
    testState.devices = [
      {
        deviceId: 'legacy-box',
        friendlyName: 'Legacy Box',
        hostname: 'legacy-box',
        online: true,
        platform: 'linux',
        scope: 'personal',
      },
    ];
    // The scan succeeded but the agent type is absent from its map (older
    // device client) — the CLI cannot run there, so the row is disabled and
    // asks the user to update the device client.
    testState.scanResults = {};
    testState.scanned = { 'legacy-box': true };

    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getByText('heteroAgent.executionTarget.cliOutdated')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Legacy Box'));
    expect(testState.selectExecutionTarget).not.toHaveBeenCalled();
  });

  it('uses the local IPC probe for the current machine row, gateway-free', () => {
    testState.isDesktop = true;
    testState.gatewayDeviceInfo = { deviceId: 'local-device' };
    // An explicit target avoids the mount-time auto-default effect.
    testState.agencyConfig = {
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    };
    testState.devices = [
      {
        deviceId: 'local-device',
        friendlyName: 'This Mac',
        hostname: 'this-mac',
        online: false,
        platform: 'darwin',
        scope: 'personal',
      },
    ];
    // The gateway is down (device listed offline) but the local IPC probe
    // says the CLI is not installed — the row must report the local verdict,
    // not a gateway scan (which could not even run).
    testState.localStatus = { available: false };

    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    // The device row reports the local IPC verdict, and so does the
    // always-rendered desktop Local row — a machine without the CLI cannot be
    // picked either way (the fenced Local sandbox row reports the same reason:
    // it too would run this machine's CLI).
    expect(screen.getAllByText('heteroAgent.executionTarget.cliNotInstalled')).toHaveLength(3);
    fireEvent.click(screen.getByText('This Mac'));
    expect(testState.selectExecutionTarget).not.toHaveBeenCalled();
  });

  it('keeps non-heterogeneous device rows enabled regardless of the scan', () => {
    testState.agencyConfig = {};

    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    fireEvent.click(screen.getByText('No CLI Box'));
    expect(testState.selectExecutionTarget).toHaveBeenCalledWith(
      'device',
      'device-no-cli',
      expect.anything(),
    );
  });

  it('disables the desktop Local row when the local CLI is absent', () => {
    testState.isDesktop = true;
    testState.agencyConfig = {
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    };
    // No connected devices — only the always-rendered Local row is in play.
    testState.devices = [];
    testState.localStatus = { available: false };

    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    // The row explains why this machine cannot be picked, … (the fenced Local
    // sandbox row shows the same reason — it would also run this machine's CLI)
    expect(screen.getAllByText('heteroAgent.executionTarget.cliNotInstalled')).toHaveLength(2);

    // …and clicking it must not select the local target.
    fireEvent.click(screen.getByText('heteroAgent.executionTarget.local'));
    expect(testState.selectExecutionTarget).not.toHaveBeenCalled();
  });

  it('disables the desktop Local sandbox row when the local CLI is absent', () => {
    testState.isDesktop = true;
    // The sandbox backend IS available — the fence still runs the agent's CLI
    // on this machine, so a missing CLI must win over the present backend and
    // disable the row instead of letting it route runs to a machine that
    // cannot run the agent.
    testState.sandboxAvailable = true;
    testState.agencyConfig = {
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    };
    // No connected devices — only the always-rendered desktop rows are in play.
    testState.devices = [];
    testState.localStatus = { available: false };

    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    // Both the plain Local row and its fenced sibling report the missing CLI, …
    expect(screen.getAllByText('heteroAgent.executionTarget.cliNotInstalled')).toHaveLength(2);

    // …and clicking the sandbox row must not select the local target either.
    fireEvent.click(screen.getByText('heteroAgent.executionTarget.localSandbox'));
    expect(testState.selectExecutionTarget).not.toHaveBeenCalled();
  });

  it('keeps the desktop Local row selectable when the local CLI is present', () => {
    testState.isDesktop = true;
    testState.agencyConfig = {
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    };
    testState.devices = [];
    testState.localStatus = { available: true };

    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    fireEvent.click(screen.getByText('heteroAgent.executionTarget.local'));
    expect(testState.selectExecutionTarget).toHaveBeenCalledWith(
      'local',
      undefined,
      expect.anything(),
    );
  });

  it('keeps the desktop Local row enabled for non-heterogeneous agents', () => {
    testState.isDesktop = true;
    // No heterogeneous provider — the local CLI probe never fires, so a
    // "missing CLI" verdict from another agent's probe must not disable it.
    testState.agencyConfig = { executionTarget: 'device' };
    testState.devices = [];
    testState.localStatus = { available: false };

    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getByText('heteroAgent.executionTarget.localDesc')).toBeInTheDocument();
    fireEvent.click(screen.getByText('heteroAgent.executionTarget.local'));
    expect(testState.selectExecutionTarget).toHaveBeenCalledWith(
      'local',
      undefined,
      expect.anything(),
    );
  });
});
