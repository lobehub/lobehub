import type { DeviceListItem, HeterogeneousProviderConfig } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeterogeneousAgentStatusCard from './HeterogeneousAgentStatusCard';

const testState = vi.hoisted(() => ({
  devices: undefined as unknown,
  gatewayDeviceInfo: undefined as { deviceId: string } | undefined,
  localAuth: null as { loggedIn: boolean; [key: string]: unknown } | null,
  localHookCalls: [] as Array<{ agentType: string; command: string }>,
  localStatus: undefined as
    | { available: boolean; path?: string; version?: string }
    | undefined,
  redetectLocal: vi.fn(),
  scanCalls: [] as Array<string | undefined>,
}));

vi.mock('@lobechat/const', () => ({
  isDesktop: true,
}));

vi.mock('@lobechat/heterogeneous-agents/client', () => ({
  getHeterogeneousAgentClientConfig: (type: string) =>
    type === 'claude-code'
      ? {
          defaultCommand: 'claude',
          icon: () => <span>Claude Code Icon</span>,
          title: 'Claude Code',
        }
      : type === 'kimi-code'
        ? {
            defaultCommand: 'kimi',
            icon: () => <span>Kimi Code Icon</span>,
            title: 'Kimi Code',
          }
        : type === 'opencode'
          ? {
              defaultCommand: 'opencode',
              icon: () => <span>OpenCode Icon</span>,
              title: 'OpenCode',
            }
          : type === 'pi'
            ? {
                defaultCommand: 'pi',
                icon: () => <span>Pi Icon</span>,
                title: 'Pi',
              }
            : {
                defaultCommand: 'codex',
                icon: () => <span>Codex Icon</span>,
                title: 'Codex',
              },
  isRemoteHeterogeneousType: (type: string) => ['openclaw', 'hermes'].includes(type),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    className,
    onClick,
  }: {
    'aria-label'?: string;
    'className'?: string;
    'onClick'?: () => void;
  }) => (
    <button aria-label={ariaLabel} className={className} type="button" onClick={onClick}>
      Refresh
    </button>
  ),
  CopyButton: () => <button type="button">Copy</button>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span>Icon</span>,
  Input: ({
    onBlur,
    onChange,
    onKeyDown,
    placeholder,
    ref,
    value,
  }: {
    onBlur?: () => void;
    onChange?: (event: { target: { value: string } }) => void;
    onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
    placeholder?: string;
    ref?: React.Ref<HTMLInputElement>;
    value?: string;
  }) => (
    <input
      placeholder={placeholder}
      ref={ref}
      value={value}
      onBlur={onBlur}
      onChange={(event) => {
        onChange?.({ target: { value: event.target.value } });
      }}
      onKeyDown={(event) => {
        onKeyDown?.({ key: event.key, preventDefault: () => event.preventDefault() });
      }}
    />
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    card: 'card',
    label: 'label',
    path: 'path',
  }),
  cssVar: new Proxy({}, { get: (_, key) => `var(--${String(key)})` }),
  cx: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('lucide-react', () => ({
  CheckCircle2: () => null,
  CircleAlert: () => null,
  Loader2Icon: () => null,
  PencilLine: () => null,
  RefreshCw: () => null,
  XCircle: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      (
        ({
          'heterogeneousStatus.account.label': 'Account',
          'heterogeneousStatus.auth.api': 'API',
          'heterogeneousStatus.auth.label': 'Auth Method',
          'heterogeneousStatus.auth.subscription': 'Subscription',
          'heterogeneousStatus.command.edit': 'Edit command',
          'heterogeneousStatus.command.label': 'Command',
          'heterogeneousStatus.command.placeholder': 'Command name or absolute path',
          'heterogeneousStatus.detecting': `Detecting ${options?.name ?? ''} CLI`,
          'heterogeneousStatus.devices.available': 'Available',
          'heterogeneousStatus.devices.checkFailed': 'Unable to check',
          'heterogeneousStatus.devices.checking': 'Checking CLI',
          'heterogeneousStatus.devices.label': 'Devices',
          'heterogeneousStatus.devices.notInstalled': 'CLI not installed',
          'heterogeneousStatus.devices.offline': 'Offline',
          'heterogeneousStatus.devices.thisDevice': 'This device',
          'heterogeneousStatus.plan.label': 'Plan',
          'heterogeneousStatus.redetect': 'Re-detect',
          'heterogeneousStatus.unavailable': `${options?.name ?? ''} CLI is unavailable`,
        }) as Record<string, string>
      )[key] || key,
  }),
}));

vi.mock('@/features/Electron/HeterogeneousAgent/StatusGuide', () => ({
  default: ({ agentType }: { agentType?: string }) => (
    <div>{`${agentType ?? 'codex'} Install Guide`}</div>
  ),
}));

vi.mock('@/features/DeviceManager/getDeviceIcon', () => ({
  getDeviceIcon: () => <span>DeviceIcon</span>,
}));

vi.mock('@/features/DeviceManager/useLocalHeteroAgentStatus', () => ({
  useLocalHeteroAgentStatus: (agentType: string | undefined, command: string | undefined) => {
    if (agentType && command) testState.localHookCalls.push({ agentType, command });
    return {
      auth: testState.localAuth,
      detecting: false,
      redetect: testState.redetectLocal,
      status: agentType ? testState.localStatus : undefined,
    };
  },
}));

vi.mock('@/features/DeviceManager/useDeviceAgentScan', () => ({
  refreshDeviceAgentScan: vi.fn(),
  useDeviceAgentScan: (deviceId: string | undefined) => {
    testState.scanCalls.push(deviceId);
    return {
      data:
        deviceId === 'device-with-cli'
          ? { available: true, version: '1.2.3' }
          : deviceId === 'device-without-cli'
            ? { available: false }
            : undefined,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      // Every device answers the scan; an absent map entry means the device
      // client predates the agent type.
      scanned: !!deviceId,
    };
  },
}));

vi.mock('@/features/DeviceManager/useDeviceList', () => ({
  useDeviceList: () => ({
    data: testState.devices,
    error: undefined,
    isLoading: false,
  }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { activeAgentId: string; agentMap: object }) => unknown) =>
    selector({ activeAgentId: 'agent-1', agentMap: {} }),
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

const remoteDevice = (deviceId: string, hostname: string, platform: string): DeviceListItem =>
  ({
    deviceId,
    hostname,
    online: true,
    platform,
    scope: 'personal',
  }) as unknown as DeviceListItem;

describe('HeterogeneousAgentStatusCard', () => {
  beforeEach(() => {
    testState.devices = undefined;
    testState.gatewayDeviceInfo = undefined;
    testState.localAuth = null;
    testState.localHookCalls = [];
    testState.localStatus = undefined;
    testState.redetectLocal.mockReset();
    testState.scanCalls = [];
  });

  it('shows the embedded Codex install guide when the CLI is unavailable', async () => {
    testState.localStatus = { available: false };

    const provider = {
      command: 'codex',
      type: 'codex',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(testState.localHookCalls).toContainEqual({ agentType: 'codex', command: 'codex' });
    });

    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('codex Install Guide')).toBeInTheDocument();
    expect(screen.getByText('codex')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('codex')).not.toBeInTheDocument();
  });

  it('detects OpenCode and shows its install guide when unavailable', async () => {
    testState.localStatus = { available: false };

    const provider = {
      command: 'opencode',
      type: 'opencode',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(testState.localHookCalls).toContainEqual({
        agentType: 'opencode',
        command: 'opencode',
      });
    });

    expect(screen.getByText('OpenCode CLI')).toBeInTheDocument();
    expect(screen.getByText('OpenCode CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('opencode Install Guide')).toBeInTheDocument();
  });

  it('detects Kimi Code and shows its install guide when unavailable', async () => {
    testState.localStatus = { available: false };

    const provider = {
      command: 'kimi',
      type: 'kimi-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(testState.localHookCalls).toContainEqual({
        agentType: 'kimi-code',
        command: 'kimi',
      });
    });

    expect(screen.getByText('Kimi Code CLI')).toBeInTheDocument();
    expect(screen.getByText('Kimi Code CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('kimi-code Install Guide')).toBeInTheDocument();
  });

  it('detects Pi and shows its install guide when unavailable', async () => {
    testState.localStatus = { available: false };

    const provider = {
      command: 'pi',
      type: 'pi',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(testState.localHookCalls).toContainEqual({ agentType: 'pi', command: 'pi' });
    });

    expect(screen.getByText('Pi CLI')).toBeInTheDocument();
    expect(screen.getByText('Pi CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('pi Install Guide')).toBeInTheDocument();
  });

  it('shows the embedded Claude Code install guide when the CLI is unavailable', async () => {
    testState.localStatus = { available: false };

    const provider = {
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(testState.localHookCalls).toContainEqual({
        agentType: 'claude-code',
        command: 'claude',
      });
    });

    expect(screen.getByText('Claude Code CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('claude-code Install Guide')).toBeInTheDocument();
  });

  it('shows auth rows with the customized Claude command', async () => {
    testState.localStatus = {
      available: true,
      path: '/Users/test/bin/claude-alt',
      version: '2.1.118 (Claude Code)',
    };
    testState.localAuth = {
      apiProvider: 'firstParty',
      authMethod: 'claude.ai',
      email: 'test@example.com',
      loggedIn: true,
      subscriptionType: 'max',
    };

    const provider = {
      command: 'claude-alt',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(testState.localHookCalls).toContainEqual({
        agentType: 'claude-code',
        command: 'claude-alt',
      });
    });

    expect(screen.getByText('claude-alt')).toBeInTheDocument();
    expect(screen.getByText('Auth Method')).toBeInTheDocument();
    expect(screen.getByText('Subscription')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('MAX')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('hides the install guide when a customized command is unavailable', async () => {
    testState.localStatus = { available: false };

    const provider = {
      command: 'claude-alt',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Claude Code CLI is unavailable')).toBeInTheDocument();
    });

    expect(screen.queryByText('claude-code Install Guide')).not.toBeInTheDocument();
    expect(screen.getByText('claude-alt')).toBeInTheDocument();
  });

  it('persists command edits on blur', async () => {
    testState.localStatus = { available: true };
    const onCommandChange = vi.fn();

    const provider = {
      command: 'codex',
      type: 'codex',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} onCommandChange={onCommandChange} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit command' }));

    const input = await screen.findByDisplayValue('codex');
    fireEvent.change(input, { target: { value: 'codex-alt' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onCommandChange).toHaveBeenCalledWith('codex-alt');
    });
  });

  it('keeps the command read-only until edit mode is activated', async () => {
    testState.localStatus = { available: true };

    const provider = {
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('claude')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('claude')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit command' }));

    expect(await screen.findByDisplayValue('claude')).toBeInTheDocument();
  });

  it('shows the gateway scan verdict for a remote device', async () => {
    testState.gatewayDeviceInfo = { deviceId: 'local-device' };

    const provider = {
      command: 'codex',
      type: 'codex',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          device={remoteDevice('device-with-cli', 'dev-server', 'linux')}
          provider={provider}
        />
      </MemoryRouter>,
    );

    // The remote verdict comes from the gateway scan (mocked: version 1.2.3),
    // not from the local Electron IPC probe.
    expect(await screen.findByText('1.2.3')).toBeInTheDocument();
    expect(testState.localHookCalls).toEqual([]);
    // Local-only detail (binary path) is absent for a remote device.
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  it('shows the gateway scan verdict when the CLI is missing on a remote device', async () => {
    testState.gatewayDeviceInfo = { deviceId: 'local-device' };

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          device={remoteDevice('device-without-cli', 'old-box', 'linux')}
          provider={{ command: 'codex', type: 'codex' }}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Codex CLI is unavailable')).toBeInTheDocument();
    expect(testState.localHookCalls).toEqual([]);
  });

  it('shows the CLI as unavailable when the remote client predates the agent type', async () => {
    testState.gatewayDeviceInfo = { deviceId: 'local-device' };

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          // 'device-legacy' answers the scan (scanned: true) but its map has
          // no entry for the agent type — an older device client that
          // predates it.
          device={remoteDevice('device-legacy', 'old-box', 'linux')}
          provider={{ command: 'codex', type: 'codex' }}
        />
      </MemoryRouter>,
    );

    // "Outdated client", not the neutral "Unable to check" verdict.
    expect(await screen.findByText('heterogeneousStatus.devices.outdatedDesc')).toBeInTheDocument();
    expect(screen.queryByText('Unable to check')).not.toBeInTheDocument();
    expect(testState.localHookCalls).toEqual([]);
  });

  it('reuses the local IPC detection when inspecting the current machine', async () => {
    testState.localStatus = {
      available: true,
      path: '/usr/local/bin/codex',
      version: '9.9.9',
    };
    testState.gatewayDeviceInfo = { deviceId: 'local-device' };

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          device={remoteDevice('local-device', 'this-mac', 'darwin')}
          provider={{ command: 'codex', type: 'codex' }}
        />
      </MemoryRouter>,
    );

    // Version/path come from the local IPC detection.
    expect(await screen.findByText('9.9.9')).toBeInTheDocument();
    expect(screen.getByText('/usr/local/bin/codex')).toBeInTheDocument();
    expect(testState.localHookCalls).toContainEqual({ agentType: 'codex', command: 'codex' });
    // The current machine is never probed through the gateway.
    expect(testState.scanCalls).not.toContain('local-device');
  });
});
