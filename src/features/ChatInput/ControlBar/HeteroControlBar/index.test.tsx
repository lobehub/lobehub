/**
 * @vitest-environment happy-dom
 */
import type * as LobechatConstModule from '@lobechat/const';
import type * as ElectronClientIpcModule from '@lobechat/electron-client-ipc';
import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openQuotaCalendarModal } from '@/features/AgentQuotaCalendar';

import HeteroControlBar from '.';
import { codexSnapshot, kimiCodeSnapshot } from './QuotaMenu/testUtils';

const mockService = vi.hoisted(() => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  getClaudeCodeQuota: vi.fn(),
  getCodexQuota: vi.fn(),
  getKimiCodeQuota: vi.fn(),
}));

const effectiveAgencyConfig = vi.hoisted(() => ({
  current: {
    boundDeviceId: 'personal-device' as string | undefined,
    executionTarget: 'local' as 'local' | 'device',
    heterogeneousProvider: {
      command: 'codex',
      type: 'codex',
    } as HeterogeneousProviderConfig,
  },
  workspaceScoped: false,
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobechatConstModule>()),
  isDesktop: true,
}));

vi.mock('@lobechat/electron-client-ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof ElectronClientIpcModule>()),
  useWatchBroadcast: vi.fn(),
}));

vi.mock('@/business/client/features/ChatInputCredits', () => ({
  default: () => <div data-testid="api-credits" />,
}));

vi.mock('@/features/ChatInput/ControlBar/WorkspaceControls', () => ({
  default: () => <div data-testid="workspace-controls" />,
}));

vi.mock('@/features/ChatInput/ControlBar/HeteroDeviceSwitcher', () => ({
  default: () => <div data-testid="hetero-device-switcher" />,
}));

vi.mock('@/features/AgentQuotaCalendar', () => ({
  openQuotaCalendarModal: vi.fn(),
}));

vi.mock('@/features/ChatInput/hooks/useAgentId', () => ({ useAgentId: () => 'agent-1' }));
vi.mock('@/features/ChatInput/hooks/useTopicId', () => ({ useTopicId: () => 'topic-1' }));

// Resource-access gating is out of scope for quota tests — keep it permissive
// so HeteroControlBar renders its full quota UI without the ChatInput store.
vi.mock('@/features/ChatInput/hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({
    canConfigureResource: true,
    canSendMessage: true,
    canUseResource: true,
    isAccessLoading: false,
  }),
}));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: effectiveAgencyConfig.current,
    workspaceScoped: effectiveAgencyConfig.workspaceScoped,
  }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    isAgentConfigLoadingById: () => () => false,
    isWorkspaceAgentById: () => () => true,
  },
}));

const translate = vi.hoisted(() => (key: string, opts?: Record<string, unknown>) => {
  const values = opts ? Object.values(opts) : [];
  return values.length > 0 ? `${key}:${values.join(',')}` : key;
});

vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: mockService,
}));

// A `deviceId` routes the live sample through the device gateway TRPC instead
// of Electron IPC (see `fetchClaudeCodeQuotaSnapshot`).
const { mockLambdaClaudeQuota, mockLambdaCodexQuota, mockLambdaKimiCodeQuota } = vi.hoisted(() => ({
  mockLambdaClaudeQuota: vi.fn(),
  mockLambdaCodexQuota: vi.fn(),
  mockLambdaKimiCodeQuota: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    device: {
      getClaudeCodeQuota: { query: mockLambdaClaudeQuota },
    },
  },
}));

// The menu reads persisted quota through TRPC before falling back to the live
// IPC fetch. Default to "nothing persisted yet" so these cases exercise the live
// path without each one stalling on a real HTTP request; individual tests can
// hand it persisted accounts/windows.
const mockQuotaService = vi.hoisted(() => ({
  getLatestReadings: vi.fn(async (): Promise<unknown[]> => []),
  ingestClaudeSnapshot: vi.fn(async () => undefined),
  ingestCodexSnapshot: vi.fn(async () => undefined),
  ingestKimiCodeSnapshot: vi.fn(async () => undefined),
  refreshCodexQuota: vi.fn(),
  refreshKimiCodeQuota: vi.fn(),
  listAccounts: vi.fn(async (): Promise<unknown[]> => []),
  listBindings: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock('@/services/agentQuota', () => ({ agentQuotaService: mockQuotaService }));

// Render keys verbatim (with interpolated values appended) so assertions can
// target the exact i18n key + params a snapshot should produce.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  return {
    ...(await importOriginal<object>()),
    ActionIcon: ({
      disabled,
      onClick,
      title,
    }: {
      disabled?: boolean;
      onClick?: () => void;
      title?: string;
    }) => (
      <button
        aria-label={title}
        data-testid={title ? 'calendar' : 'refresh'}
        disabled={disabled}
        type="button"
        onClick={onClick}
      />
    ),
    Flexbox: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    Icon: () => <svg />,
    // Render the popover content unconditionally so window rows are assertable
    // without driving the open/close interaction.
    Popover: ({
      children,
      content,
      onOpenChange,
    }: {
      children?: ReactNode;
      content?: ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => (
      <div>
        <div data-testid="popover-content">{content}</div>
        <div data-testid="quota-trigger" onClick={() => onOpenChange?.(true)}>
          {children}
        </div>
      </div>
    ),
    Skeleton: ({ height }: { height?: number }) => (
      <div data-height={height} data-testid="skeleton" />
    ),
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

beforeEach(() => {
  effectiveAgencyConfig.current = {
    boundDeviceId: 'personal-device',
    executionTarget: 'local',
    heterogeneousProvider: { command: 'codex', type: 'codex' },
  };
  effectiveAgencyConfig.workspaceScoped = false;
  mockService.consumeCodexRateLimitResetCredit.mockReset();
  mockService.getClaudeCodeQuota.mockReset();
  mockService.getCodexQuota.mockReset();
  mockService.getKimiCodeQuota.mockReset();
  mockLambdaClaudeQuota.mockReset();
  mockLambdaCodexQuota.mockReset();
  mockLambdaKimiCodeQuota.mockReset();
  mockQuotaService.refreshCodexQuota.mockImplementation(mockLambdaCodexQuota);
  mockQuotaService.refreshKimiCodeQuota.mockImplementation(mockLambdaKimiCodeQuota);
  mockQuotaService.getLatestReadings.mockResolvedValue([]);
  mockQuotaService.ingestClaudeSnapshot.mockClear();
  mockQuotaService.ingestKimiCodeSnapshot.mockClear();
  mockQuotaService.listAccounts.mockResolvedValue([]);
  mockQuotaService.listBindings.mockResolvedValue([]);
  vi.mocked(openQuotaCalendarModal).mockClear();
});

describe('HeteroControlBar', () => {
  it('shows local Codex quota for a workspace member local-device override', async () => {
    mockService.getCodexQuota.mockResolvedValue(
      codexSnapshot({ session: { resetsAt: null, usedPercent: 20, windowMinutes: 300 } }),
    );

    render(<HeteroControlBar />);

    expect(
      await screen.findByRole('button', { name: 'heteroAgent.codexQuota.tooltip' }),
    ).toBeTruthy();
    expect(screen.queryByTestId('api-credits')).toBeNull();
    expect(mockService.getCodexQuota).toHaveBeenCalledWith({ command: 'codex', env: undefined });
  });

  it('shows Codex quota sampled by a bound remote device', async () => {
    effectiveAgencyConfig.current = {
      boundDeviceId: 'remote-device',
      executionTarget: 'device',
      heterogeneousProvider: { command: 'codex', type: 'codex' },
    };
    mockLambdaCodexQuota.mockResolvedValue(
      codexSnapshot({ session: { resetsAt: null, usedPercent: 20, windowMinutes: 300 } }),
    );

    render(<HeteroControlBar />);

    expect(
      await screen.findByRole('button', { name: 'heteroAgent.codexQuota.tooltip' }),
    ).toBeTruthy();
    expect(mockLambdaCodexQuota).toHaveBeenCalledWith({
      command: 'codex',
      deviceId: 'remote-device',
      env: undefined,
    });
    expect(mockService.getCodexQuota).not.toHaveBeenCalled();
  });

  it('shows remote quota for a workspace shared-device fallback', async () => {
    effectiveAgencyConfig.current = {
      boundDeviceId: 'workspace-device',
      executionTarget: 'local',
      heterogeneousProvider: { command: 'codex', type: 'codex' },
    };
    effectiveAgencyConfig.workspaceScoped = true;
    mockLambdaCodexQuota.mockResolvedValue(
      codexSnapshot({ session: { resetsAt: null, usedPercent: 20, windowMinutes: 300 } }),
    );

    render(<HeteroControlBar />);

    expect(
      await screen.findByRole('button', { name: 'heteroAgent.codexQuota.tooltip' }),
    ).toBeTruthy();
    expect(mockLambdaCodexQuota).toHaveBeenCalledWith({
      command: 'codex',
      deviceId: 'workspace-device',
      env: undefined,
    });
    expect(mockService.getCodexQuota).not.toHaveBeenCalled();
  });

  it('shows platform credits instead of Codex quota in API mode', () => {
    effectiveAgencyConfig.current = {
      boundDeviceId: 'personal-device',
      executionTarget: 'local',
      heterogeneousProvider: { authMode: 'api', command: 'codex', type: 'codex' },
    };

    render(<HeteroControlBar />);

    expect(screen.getByTestId('api-credits')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'heteroAgent.codexQuota.tooltip' })).toBeNull();
    expect(mockService.getCodexQuota).not.toHaveBeenCalled();
  });

  it('shows platform credits instead of Claude Code quota in API mode', () => {
    effectiveAgencyConfig.current = {
      boundDeviceId: 'personal-device',
      executionTarget: 'local',
      heterogeneousProvider: { authMode: 'api', type: 'claude-code' },
    };

    render(<HeteroControlBar />);

    expect(screen.getByTestId('api-credits')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'heteroAgent.claudeQuota.tooltip' })).toBeNull();
    expect(mockService.getClaudeCodeQuota).not.toHaveBeenCalled();
  });

  it('hides the full-access badge for Devin, whose session mode is selectable', () => {
    effectiveAgencyConfig.current = {
      boundDeviceId: 'personal-device',
      executionTarget: 'local',
      heterogeneousProvider: { command: 'devin', mode: 'plan', type: 'devin' },
    };

    render(<HeteroControlBar />);

    expect(screen.queryByText('heteroAgent.fullAccess.label')).toBeNull();
  });

  it('keeps the full-access badge for providers without a mode selector', () => {
    render(<HeteroControlBar />);

    expect(screen.getByText('heteroAgent.fullAccess.label')).toBeTruthy();
  });

  it('shows local Kimi Code quota for a local execution target', async () => {
    effectiveAgencyConfig.current = {
      boundDeviceId: 'personal-device',
      executionTarget: 'local',
      heterogeneousProvider: { command: 'kimi', type: 'kimi-code' },
    };
    mockService.getKimiCodeQuota.mockResolvedValue(
      kimiCodeSnapshot({ session: { resetsAt: null, usedPercent: 20, windowMinutes: 300 } }),
    );

    render(<HeteroControlBar />);

    expect(
      await screen.findByRole('button', { name: 'heteroAgent.kimiCodeQuota.tooltip' }),
    ).toBeTruthy();
    expect(mockService.getKimiCodeQuota).toHaveBeenCalledWith({ env: undefined });
    expect(mockService.getCodexQuota).not.toHaveBeenCalled();
  });

  it('shows Kimi Code quota sampled by a bound remote device', async () => {
    effectiveAgencyConfig.current = {
      boundDeviceId: 'remote-device',
      executionTarget: 'device',
      heterogeneousProvider: { command: 'kimi', type: 'kimi-code' },
    };
    mockLambdaKimiCodeQuota.mockResolvedValue(
      kimiCodeSnapshot({ session: { resetsAt: null, usedPercent: 20, windowMinutes: 300 } }),
    );

    render(<HeteroControlBar />);

    expect(
      await screen.findByRole('button', { name: 'heteroAgent.kimiCodeQuota.tooltip' }),
    ).toBeTruthy();
    expect(mockLambdaKimiCodeQuota).toHaveBeenCalledWith({
      deviceId: 'remote-device',
      env: undefined,
    });
    expect(mockService.getKimiCodeQuota).not.toHaveBeenCalled();
  });
});
