/**
 * @vitest-environment happy-dom
 */
import type * as LobechatConstModule from '@lobechat/const';
import type * as ElectronClientIpcModule from '@lobechat/electron-client-ipc';
import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeteroControlBar from '..';
import ClaudeCodeQuotaMenu from './ClaudeCodeQuotaMenu';
import CodexQuotaMenu from './CodexQuotaMenu';

const mockService = vi.hoisted(() => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  getClaudeCodeQuota: vi.fn(),
  getCodexQuota: vi.fn(),
}));

const effectiveAgencyConfig = vi.hoisted(() => ({
  current: {
    boundDeviceId: 'personal-device' as string | undefined,
    executionTarget: 'local' as const,
    heterogeneousProvider: {
      command: 'codex',
      type: 'codex',
    } as HeterogeneousProviderConfig,
  },
  workspaceScoped: false,
}));
const labPreferences = vi.hoisted(() => ({ enableAgentProviderBinding: true }));

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

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ preference: { lab: labPreferences } }),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: {
    enableAgentProviderBinding: (state: {
      preference: { lab: { enableAgentProviderBinding: boolean } };
    }) => state.preference.lab.enableAgentProviderBinding,
  },
}));

const { confirmModalMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  confirmModalMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
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
const mockLambdaDeviceQuota = vi.hoisted(() => vi.fn());

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { device: { getClaudeCodeQuota: { query: mockLambdaDeviceQuota } } },
}));

// The menu reads persisted quota through TRPC before falling back to the live
// IPC fetch. Default to "nothing persisted yet" so these cases exercise the live
// path without each one stalling on a real HTTP request; individual tests can
// hand it persisted accounts/windows.
const mockQuotaService = vi.hoisted(() => ({
  getLatestReadings: vi.fn(async (): Promise<unknown[]> => []),
  ingestClaudeSnapshot: vi.fn(async () => undefined),
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
  const { useState } = await import('react');

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
    Collapse: ({
      defaultActiveKey = [],
      items,
    }: {
      defaultActiveKey?: string[];
      items: { children?: ReactNode; key: string; label?: ReactNode }[];
    }) => {
      const [activeKeys, setActiveKeys] = useState(defaultActiveKey);

      return (
        <div>
          {items.map((item) => {
            const expanded = activeKeys.includes(item.key);

            return (
              <div key={item.key}>
                <button
                  aria-expanded={expanded}
                  type="button"
                  onClick={() => setActiveKeys(expanded ? [] : [item.key])}
                >
                  {item.label}
                </button>
                {expanded && item.children}
              </div>
            );
          })}
        </div>
      );
    },
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
    Skeleton: { Button: () => <div data-testid="skeleton" /> },
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  ActionIcon: ({
    onClick,
    title,
    disabled,
  }: {
    disabled?: boolean;
    onClick?: (e: React.MouseEvent) => void;
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
  confirmModal: confirmModalMock,
  Skeleton: ({ height }: { height?: number }) => (
    <div data-height={height} data-testid="skeleton" />
  ),
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

const claudeSnapshot = (
  overrides: Partial<ElectronClientIpcModule.ClaudeCodeQuotaSnapshot> = {},
): ElectronClientIpcModule.ClaudeCodeQuotaSnapshot => ({
  error: null,
  provider: 'claude-code',
  scopedWeekly: null,
  session: null,
  status: 'ok',
  updatedAt: Date.now(),
  weekly: null,
  ...overrides,
});

const persistedAccount = (updatedAt = Date.now()) => ({
  externalAccountId: 'ext-1',
  id: 'acc-1',
  provider: 'claude-code',
  updatedAt: new Date(updatedAt),
});

/** The account's newest persisted session reading, captured at `capturedAt`. */
const persistedSessionReading = (capturedAt: number) => ({
  capturedAt,
  limitType: 'session',
  resetsAt: null,
  scopeKey: '',
  utilization: 8,
});

/** A live session reading as fossilized by the desktop sampler at `capturedAt`. */
const liveSessionReading = (capturedAt: number) => ({
  capturedAt,
  isActive: true,
  limitType: 'session',
  resetsAt: null,
  scopeKey: '',
  utilization: 8,
});

const codexSnapshot = (
  overrides: Partial<ElectronClientIpcModule.CodexQuotaSnapshot> = {},
): ElectronClientIpcModule.CodexQuotaSnapshot => ({
  error: null,
  provider: 'codex',
  rateLimitResetCredits: null,
  session: null,
  status: 'ok',
  updatedAt: Date.now(),
  weekly: null,
  ...overrides,
});

beforeEach(() => {
  effectiveAgencyConfig.current = {
    boundDeviceId: 'personal-device',
    executionTarget: 'local',
    heterogeneousProvider: { command: 'codex', type: 'codex' },
  };
  effectiveAgencyConfig.workspaceScoped = false;
  labPreferences.enableAgentProviderBinding = true;
  confirmModalMock.mockReset();
  mockService.consumeCodexRateLimitResetCredit.mockReset();
  mockService.getClaudeCodeQuota.mockReset();
  mockService.getCodexQuota.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  mockQuotaService.getLatestReadings.mockResolvedValue([]);
  mockQuotaService.ingestClaudeSnapshot.mockClear();
  mockQuotaService.listAccounts.mockResolvedValue([]);
  mockQuotaService.listBindings.mockResolvedValue([]);
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

  it('does not show local quota for a workspace shared-local fallback without an override', () => {
    effectiveAgencyConfig.current = {
      boundDeviceId: 'workspace-device',
      executionTarget: 'local',
      heterogeneousProvider: { command: 'codex', type: 'codex' },
    };
    effectiveAgencyConfig.workspaceScoped = true;

    render(<HeteroControlBar />);

    expect(screen.queryByRole('button', { name: 'heteroAgent.codexQuota.tooltip' })).toBeNull();
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

  it('hides platform credits when API mode is disabled in Labs', () => {
    labPreferences.enableAgentProviderBinding = false;
    effectiveAgencyConfig.current = {
      boundDeviceId: 'personal-device',
      executionTarget: 'local',
      heterogeneousProvider: { authMode: 'api', command: 'codex', type: 'codex' },
    };

    render(<HeteroControlBar />);

    expect(screen.queryByTestId('api-credits')).toBeNull();
    expect(screen.queryByRole('button', { name: 'heteroAgent.codexQuota.tooltip' })).toBeNull();
    expect(mockService.getCodexQuota).not.toHaveBeenCalled();
  });
});

describe('ClaudeCodeQuotaMenu', () => {
  it('renders session, weekly, and model-scoped windows from the snapshot', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({
        scopedWeekly: {
          modelName: 'Fable',
          window: { resetsAt: null, usedPercent: 24, windowMinutes: 10_080 },
        },
        session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
        weekly: { resetsAt: null, usedPercent: 13, windowMinutes: 10_080 },
      }),
    );

    render(<ClaudeCodeQuotaMenu env={{ CLAUDE_CONFIG_DIR: '/custom' }} />);

    expect(await screen.findByText('heteroAgent.quota.session')).toBeTruthy();
    expect(screen.getByText('heteroAgent.quota.weekly')).toBeTruthy();
    expect(screen.getByText('heteroAgent.claudeQuota.scopedWeekly:Fable')).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
    const trigger = screen.getByRole('button', { name: 'heteroAgent.claudeQuota.tooltip' });
    expect(trigger.textContent).toContain(
      'heteroAgent.quota.weekly heteroAgent.quota.compactLeft:87',
    );
    expect(trigger.textContent).toContain('Fable heteroAgent.quota.compactLeft:76');
    expect(mockService.getClaudeCodeQuota).toHaveBeenCalledWith({
      env: { CLAUDE_CONFIG_DIR: '/custom' },
    });
  });

  it('shows the tightest global window and Fable as separate compact values', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({
        scopedWeekly: {
          modelName: 'Fable',
          window: { resetsAt: null, usedPercent: 100, windowMinutes: 10_080 },
        },
        session: { resetsAt: null, usedPercent: 49, windowMinutes: 300 },
        weekly: { resetsAt: null, usedPercent: 53, windowMinutes: 10_080 },
      }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('heteroAgent.quota.exhausted')).toBeTruthy();
    const trigger = screen.getByRole('button', { name: 'heteroAgent.claudeQuota.tooltip' });
    expect(trigger.textContent).toContain(
      'heteroAgent.quota.weekly heteroAgent.quota.compactLeft:47',
    );
    expect(trigger.textContent).toContain('Fable heteroAgent.quota.compactLeft:0');
    expect(trigger.textContent).not.toContain('heteroAgent.quota.exhausted');
    expect(
      [...trigger.querySelectorAll('[data-quota-level]')].map((item) =>
        item.getAttribute('data-quota-level'),
      ),
    ).toEqual(['normal', 'low']);
  });

  it('warns below 15 percent and keeps compact zero quota numeric', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({
        session: { resetsAt: null, usedPercent: 100, windowMinutes: 300 },
        weekly: { resetsAt: null, usedPercent: 86, windowMinutes: 10_080 },
      }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findAllByText('heteroAgent.quota.exhausted')).toHaveLength(1);
    expect(screen.getByText('14%')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'heteroAgent.claudeQuota.tooltip' }).textContent,
    ).toContain('heteroAgent.quota.session heteroAgent.quota.compactLeft:0');
    // Only the 14%-left weekly window warns; the exhausted session reads as
    // "nothing to do until reset" and stays grey rather than alarm-orange.
    expect(document.querySelectorAll('[data-quota-level="low"]')).toHaveLength(2);
  });

  it('maps unavailable reasons to their localized explanations', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({
        error: 'raw main-process message',
        reason: 'external-auth',
        status: 'unavailable',
      }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('heteroAgent.claudeQuota.unavailableExternalAuth')).toBeTruthy();
    expect(screen.queryByText('raw main-process message')).toBeNull();
  });

  it('shows a friendly rate-limit message for first-load 429 errors', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({ error: 'Anthropic usage API returned 429', status: 'error' }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('heteroAgent.claudeQuota.errorRateLimited')).toBeTruthy();
    expect(screen.queryByText('Anthropic usage API returned 429')).toBeNull();

    fireEvent.click(screen.getByTestId('refresh'));
    // the refresh resolves the persisted account first, so the live call lands a
    // tick later than the click
    await waitFor(() => expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(2));
    expect(mockService.getClaudeCodeQuota).toHaveBeenLastCalledWith({
      env: undefined,
      force: true,
    });
  });

  it('keeps cached windows visible when the main-process refresh is rate-limited', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({
        error: 'Anthropic usage API returned 429',
        session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
        status: 'error',
        updatedAt: Date.now() - 5 * 60_000,
      }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('92%')).toBeTruthy();
    expect(screen.getByText('heteroAgent.claudeQuota.refreshRateLimited')).toBeTruthy();
    expect(screen.queryByText('heteroAgent.claudeQuota.errorRateLimited')).toBeNull();
  });

  it('falls back to the live snapshot when the account identity is unresolvable', async () => {
    // Quota comes from the keychain, but ~/.claude.json may carry no
    // oauthAccount.accountUuid — nothing can be persisted, so the live readings
    // must still render instead of an empty panel.
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({
        identity: undefined,
        session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
      }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('92%')).toBeTruthy();
    expect(mockQuotaService.ingestClaudeSnapshot).not.toHaveBeenCalled();
  });

  it('falls back to the live snapshot when a persisted account has no windows', async () => {
    // An account row can exist while every reading was dropped (e.g. no usable
    // reset), which used to render "unavailable" despite a healthy live fetch.
    mockQuotaService.listAccounts.mockResolvedValue([
      { externalAccountId: 'ext-1', id: 'acc-1', provider: 'claude-code' },
    ]);
    mockQuotaService.getLatestReadings.mockResolvedValue([]);
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({ session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 } }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('92%')).toBeTruthy();
  });

  it('degrades to the unavailable state when the live quota request rejects', async () => {
    mockService.getClaudeCodeQuota.mockRejectedValueOnce(new Error('network failed'));

    render(<ClaudeCodeQuotaMenu />);

    // Nothing persisted and the live fetch blew up: show the neutral empty state
    // rather than leaking a raw transport error into the panel.
    expect(await screen.findAllByText('heteroAgent.quota.unavailable')).not.toHaveLength(0);
    expect(screen.queryByText('network failed')).toBeNull();
  });

  it('keeps the previous quota data when an automatic stale refresh is rate-limited', async () => {
    const staleUpdatedAt = Date.now() - 61_000;

    mockService.getClaudeCodeQuota
      .mockResolvedValueOnce(
        claudeSnapshot({
          session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
          updatedAt: staleUpdatedAt,
        }),
      )
      .mockResolvedValueOnce(
        claudeSnapshot({ error: 'Anthropic usage API returned 429', status: 'error' }),
      )
      .mockResolvedValueOnce(
        claudeSnapshot({
          session: { resetsAt: null, usedPercent: 20, windowMinutes: 300 },
        }),
      );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('92%')).toBeTruthy();

    fireEvent.click(screen.getByTestId('quota-trigger'));

    await waitFor(() => expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(2));
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.queryByText('Anthropic usage API returned 429')).toBeNull();
    expect(screen.queryByText('heteroAgent.claudeQuota.refreshRateLimited')).toBeNull();

    fireEvent.click(screen.getByTestId('quota-trigger'));

    expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(2);
  });

  it('keeps stale data and shows a friendly prompt when manual refresh is rate-limited', async () => {
    mockService.getClaudeCodeQuota
      .mockResolvedValueOnce(
        claudeSnapshot({
          session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
        }),
      )
      .mockResolvedValueOnce(
        claudeSnapshot({ error: 'Anthropic usage API returned 429', status: 'error' }),
      );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('92%')).toBeTruthy();

    fireEvent.click(screen.getByTestId('refresh'));

    await screen.findByText('heteroAgent.claudeQuota.refreshRateLimited');
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.queryByText('Anthropic usage API returned 429')).toBeNull();
  });

  it('does not preserve quota data after switching Claude Code credential source', async () => {
    mockService.getClaudeCodeQuota
      .mockResolvedValueOnce(
        claudeSnapshot({
          session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
        }),
      )
      .mockResolvedValueOnce(
        claudeSnapshot({ error: 'Anthropic usage API returned 429', status: 'error' }),
      );

    const { rerender } = render(<ClaudeCodeQuotaMenu env={{ CLAUDE_CONFIG_DIR: '/profile-a' }} />);

    expect(await screen.findByText('92%')).toBeTruthy();

    rerender(<ClaudeCodeQuotaMenu env={{ CLAUDE_CONFIG_DIR: '/profile-b' }} />);

    await waitFor(() => expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('heteroAgent.claudeQuota.errorRateLimited')).toBeTruthy();
    expect(screen.queryByText('92%')).toBeNull();
  });

  it('ignores stale request loading updates after switching Claude Code credential source', async () => {
    const requests: Array<(snapshot: ElectronClientIpcModule.ClaudeCodeQuotaSnapshot) => void> = [];
    mockService.getClaudeCodeQuota.mockImplementation(
      () =>
        new Promise<ElectronClientIpcModule.ClaudeCodeQuotaSnapshot>((resolve) => {
          requests.push(resolve);
        }),
    );

    const { rerender } = render(<ClaudeCodeQuotaMenu env={{ CLAUDE_CONFIG_DIR: '/profile-a' }} />);

    await waitFor(() => expect(requests).toHaveLength(1));

    rerender(<ClaudeCodeQuotaMenu env={{ CLAUDE_CONFIG_DIR: '/profile-b' }} />);

    await waitFor(() => expect(requests).toHaveLength(2));

    await act(async () => {
      requests[0](
        claudeSnapshot({
          session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
        }),
      );
    });

    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
    expect(screen.queryByText('heteroAgent.quota.noData')).toBeNull();
    expect((screen.getByTestId('refresh') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      requests[1](
        claudeSnapshot({
          session: { resetsAt: null, usedPercent: 20, windowMinutes: 300 },
        }),
      );
    });

    expect(await screen.findByText('80%')).toBeTruthy();
    expect((screen.getByTestId('refresh') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders the empty state when the snapshot has no windows', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValue(claudeSnapshot());

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('heteroAgent.quota.noData')).toBeTruthy();
  });

  it('shows the live sample when the persisted window has already reset', async () => {
    // A device offline since yesterday leaves a reading behind whose window has
    // since reset. Its 100% describes spend that already refilled, so a sample
    // attributable to the same account must lead.
    mockQuotaService.listAccounts.mockResolvedValue([persistedAccount(Date.now() - 60 * 60_000)]);
    mockQuotaService.getLatestReadings.mockResolvedValue([
      {
        ...persistedSessionReading(Date.now() - 24 * 60 * 60_000),
        resetsAt: Date.now() - 60 * 60_000,
        utilization: 100,
      },
    ]);
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({
        identity: { externalAccountId: 'ext-1' },
        readings: [{ ...liveSessionReading(Date.now()), utilization: 4 }],
        session: { resetsAt: null, usedPercent: 4, windowMinutes: 300 },
      }),
    );

    render(<ClaudeCodeQuotaMenu />);

    // 96% left from the live sample — not the reset row's 100%, and not empty.
    expect(await screen.findByText('96%')).toBeTruthy();
    expect(screen.queryByText('heteroAgent.quota.noData')).toBeNull();
  });

  it('will not paint an unattributable sample under a named account', async () => {
    // Same setup, except the sample carries no account identity (no
    // `oauthAccount` in ~/.claude.json while the quota came from the keychain).
    // With several logins on the machine it may belong to another account, so
    // the panel keeps the account's own refilled window instead.
    mockQuotaService.listAccounts.mockResolvedValue([persistedAccount(Date.now() - 60 * 60_000)]);
    mockQuotaService.getLatestReadings.mockResolvedValue([
      {
        ...persistedSessionReading(Date.now() - 24 * 60 * 60_000),
        resetsAt: Date.now() - 60 * 60_000,
        utilization: 100,
      },
    ]);
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({ session: { resetsAt: null, usedPercent: 4, windowMinutes: 300 } }),
    );

    render(<ClaudeCodeQuotaMenu />);

    // The reset window reads as refilled; the unattributable 96% is not shown.
    expect(await screen.findByText('100%')).toBeTruthy();
    expect(screen.queryByText('96%')).toBeNull();
  });

  it('keeps the 5-hour row on screen as refilled once its window resets', async () => {
    // The regression: after five idle hours the session window rolls over and
    // the panel used to drop the row entirely, leaving the weekly limit alone
    // as if the plan had no session limit. A reset window is free, not absent.
    mockQuotaService.listAccounts.mockResolvedValue([persistedAccount(Date.now() - 60_000)]);
    mockQuotaService.getLatestReadings.mockResolvedValue([
      {
        ...persistedSessionReading(Date.now() - 60_000),
        resetsAt: Date.now() - 30 * 60_000,
        utilization: 83,
      },
      {
        capturedAt: Date.now() - 60_000,
        limitType: 'weekly_all',
        resetsAt: Date.now() + 4 * 24 * 60 * 60_000,
        scopeKey: '',
        utilization: 21,
      },
    ]);

    render(<ClaudeCodeQuotaMenu />);

    // Session refilled to 100% left, weekly still at 79% — two rows, not one.
    expect(await screen.findByText('100%')).toBeTruthy();
    expect(screen.getByText('79%')).toBeTruthy();
    expect(mockService.getClaudeCodeQuota).not.toHaveBeenCalled();
  });

  it('renders persisted windows without a live call while the newest reading is fresh', async () => {
    mockQuotaService.listAccounts.mockResolvedValue([persistedAccount(Date.now() - 60_000)]);
    mockQuotaService.getLatestReadings.mockResolvedValue([
      persistedSessionReading(Date.now() - 60_000),
    ]);

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('92%')).toBeTruthy();
    expect(mockService.getClaudeCodeQuota).not.toHaveBeenCalled();
  });

  it('refreshes from the live API when the newest persisted reading is stale', async () => {
    // Under the previous 30 min policy this 31-minute-old reading is a
    // conservative stale case; the gate now trips at 2 minutes.
    mockQuotaService.listAccounts.mockResolvedValue([persistedAccount(Date.now() - 31 * 60_000)]);
    mockQuotaService.getLatestReadings.mockResolvedValue([
      persistedSessionReading(Date.now() - 31 * 60_000),
    ]);
    mockService.getClaudeCodeQuota.mockResolvedValue(claudeSnapshot());

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('92%')).toBeTruthy();
    await waitFor(() =>
      expect(mockService.getClaudeCodeQuota).toHaveBeenCalledWith({ env: undefined }),
    );
  });

  it('paints persisted windows while a stale live refresh is still in flight', async () => {
    mockQuotaService.listAccounts.mockResolvedValue([persistedAccount(Date.now() - 31 * 60_000)]);
    mockQuotaService.getLatestReadings.mockResolvedValue([
      persistedSessionReading(Date.now() - 31 * 60_000),
    ]);
    const requests: Array<(snapshot: ElectronClientIpcModule.ClaudeCodeQuotaSnapshot) => void> = [];
    mockService.getClaudeCodeQuota.mockImplementation(
      () =>
        new Promise<ElectronClientIpcModule.ClaudeCodeQuotaSnapshot>((resolve) => {
          requests.push(resolve);
        }),
    );

    render(<ClaudeCodeQuotaMenu />);

    // The persisted snapshot lands before the live promise resolves — no skeleton.
    expect(await screen.findByText('92%')).toBeTruthy();
    expect(screen.queryByTestId('skeleton')).toBeNull();
    expect((screen.getByTestId('refresh') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      requests[0](claudeSnapshot());
    });

    expect(screen.getByText('92%')).toBeTruthy();
    expect((screen.getByTestId('refresh') as HTMLButtonElement).disabled).toBe(false);
  });

  it('revalidates against the live API when the window regains focus', async () => {
    // 90 s: fresh for the mount gate (2 min) but past the focus gate (60 s).
    mockQuotaService.listAccounts.mockResolvedValue([persistedAccount(Date.now() - 90_000)]);
    mockQuotaService.getLatestReadings.mockResolvedValue([
      persistedSessionReading(Date.now() - 90_000),
    ]);
    mockService.getClaudeCodeQuota.mockResolvedValue(claudeSnapshot());

    render(<ClaudeCodeQuotaMenu />);

    // Fresh persisted data: nothing hits the live API on mount…
    expect(await screen.findByText('92%')).toBeTruthy();
    expect(mockService.getClaudeCodeQuota).not.toHaveBeenCalled();

    // …but regaining focus revalidates (the main-process cache rate-limits it).
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(1));
    expect(mockService.getClaudeCodeQuota).toHaveBeenCalledWith({ env: undefined });
  });

  it('samples through the device gateway RPC when a deviceId is provided', async () => {
    mockLambdaDeviceQuota.mockResolvedValue(
      claudeSnapshot({ session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 } }),
    );

    render(<ClaudeCodeQuotaMenu deviceId="remote-device" />);

    await waitFor(() =>
      expect(mockLambdaDeviceQuota).toHaveBeenCalledWith({
        deviceId: 'remote-device',
        env: undefined,
      }),
    );
    expect(await screen.findByText('92%')).toBeTruthy();
    expect(mockService.getClaudeCodeQuota).not.toHaveBeenCalled();
  });

  it('does not reuse another device account when the newly selected device is unavailable', async () => {
    const capturedAt = Date.now();
    const account = persistedAccount();
    mockQuotaService.listAccounts.mockResolvedValue([account]);
    mockQuotaService.getLatestReadings.mockResolvedValue([persistedSessionReading(capturedAt)]);
    mockLambdaDeviceQuota.mockResolvedValueOnce(
      claudeSnapshot({
        identity: { externalAccountId: 'ext-1' },
        readings: [liveSessionReading(capturedAt)],
      }),
    );

    const { rerender } = render(<ClaudeCodeQuotaMenu deviceId="device-a" />);
    expect(await screen.findByText('92%')).toBeTruthy();

    mockLambdaDeviceQuota.mockResolvedValueOnce(null);
    rerender(<ClaudeCodeQuotaMenu deviceId="device-b" />);

    await waitFor(() =>
      expect(mockLambdaDeviceQuota).toHaveBeenLastCalledWith({
        deviceId: 'device-b',
        env: undefined,
      }),
    );
    await waitFor(() => expect(screen.queryByText('92%')).toBeNull());
  });

  it('auto-refreshes on the poll cadence while the tab stays visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });

      mockQuotaService.listAccounts.mockResolvedValue([persistedAccount()]);
      mockQuotaService.getLatestReadings.mockResolvedValue([
        persistedSessionReading(Date.now() - 60_000),
      ]);
      mockService.getClaudeCodeQuota.mockResolvedValue(claudeSnapshot());

      render(<ClaudeCodeQuotaMenu />);

      expect(await screen.findByText('92%')).toBeTruthy();
      expect(mockService.getClaudeCodeQuota).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * 60_000 + 500);
      });

      expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-ingest a cached live snapshot echoed back during revalidation', async () => {
    // The sampler cache stays fresh for 90 s, so a focus revalidation can get
    // the already-persisted readings back (same capturedAt). Snapshots are
    // append-only — re-ingesting the echo would duplicate history rows.
    // 90 s: fresh for the mount gate (2 min) but past the focus gate (60 s).
    const persistedAt = Date.now() - 90_000;
    mockQuotaService.listAccounts.mockResolvedValue([persistedAccount(Date.now() - 90_000)]);
    mockQuotaService.getLatestReadings.mockResolvedValue([persistedSessionReading(persistedAt)]);
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({
        identity: { externalAccountId: 'ext-1' },
        readings: [liveSessionReading(persistedAt)],
      }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('92%')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(1));
    expect(mockQuotaService.ingestClaudeSnapshot).not.toHaveBeenCalled();
  });

  it('ingests genuinely fresh readings surfaced by a revalidation', async () => {
    const persistedAt = Date.now() - 90_000;
    mockQuotaService.listAccounts.mockResolvedValue([persistedAccount(Date.now() - 90_000)]);
    mockQuotaService.getLatestReadings.mockResolvedValue([persistedSessionReading(persistedAt)]);
    const readings = [liveSessionReading(Date.now())];
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({ identity: { externalAccountId: 'ext-1' }, readings }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('92%')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() =>
      expect(mockQuotaService.ingestClaudeSnapshot).toHaveBeenCalledWith({
        deviceId: undefined,
        identity: { externalAccountId: 'ext-1' },
        readings,
      }),
    );
  });

  it('skips the focus revalidation while the snapshot is under a minute old', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({ session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 } }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('92%')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(1);
  });
});

describe('CodexQuotaMenu', () => {
  it.each([
    [
      'failed to fetch codex rate limits: error sending request for url (https://chatgpt.com/backend-api/wham/usage)',
      'heteroAgent.codexQuota.errorConnection',
    ],
    ['unexpected RPC failure', 'heteroAgent.codexQuota.errorGeneric'],
  ])('shows a friendly error instead of exposing %s', async (error, expectedMessage) => {
    mockService.getCodexQuota.mockResolvedValue(codexSnapshot({ error, status: 'error' }));

    render(<CodexQuotaMenu command="codex" />);

    expect(await screen.findByText(expectedMessage)).toBeTruthy();
    expect(screen.queryByText(error)).toBeNull();
  });

  it('renders windows and the reset-credits footer', async () => {
    const resetsAt = Date.now() + 60 * 60_000;
    mockService.getCodexQuota.mockResolvedValue(
      codexSnapshot({
        rateLimitResetCredits: { availableCount: 4, nextExpiresAt: null },
        session: { resetsAt, usedPercent: 19, windowMinutes: 300 },
        weekly: { resetsAt: resetsAt + 60 * 60_000, usedPercent: 88, windowMinutes: 10_080 },
      }),
    );

    render(<CodexQuotaMenu command="codex" />);

    expect(await screen.findByText('81%')).toBeTruthy();
    expect(screen.getByText('12%')).toBeTruthy();
    expect(screen.getByText('heteroAgent.quota.compactLeft:12')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'heteroAgent.codexQuota.tooltip' })
        .getAttribute('data-quota-level'),
    ).toBe('low');
    expect(screen.getByText('heteroAgent.codexQuota.fiveHour')).toBeTruthy();
    expect(screen.getByText('heteroAgent.quota.weekly')).toBeTruthy();
    // each row carries its reset as a bare short duration, not a resetsIn/resetAt sentence
    expect(
      screen.getAllByText((content) => content.startsWith('heteroAgent.quota.duration.')),
    ).toHaveLength(2);
    const resetCreditsSummary = screen.getByText('heteroAgent.codexQuota.resetCredits:4');
    expect(resetCreditsSummary.closest('button')?.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('#1')).toBeNull();

    fireEvent.click(resetCreditsSummary);

    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.getByText('#2')).toBeTruthy();
    expect(screen.getByText('#3')).toBeTruthy();
    expect(screen.getByText('#4')).toBeTruthy();
    expect(
      screen.getAllByText('heteroAgent.codexQuota.resetCreditDetailsUnavailable'),
    ).toHaveLength(4);
    expect(mockService.getCodexQuota).toHaveBeenCalledWith({ command: 'codex', env: undefined });

    fireEvent.click(screen.getByTestId('refresh'));
    await waitFor(() => expect(mockService.getCodexQuota).toHaveBeenCalledTimes(2));
    expect(mockService.getCodexQuota).toHaveBeenLastCalledWith({
      command: 'codex',
      env: undefined,
      force: true,
    });
  });

  it('hides model-specific rate-limit buckets and excludes them from the trigger', async () => {
    mockService.getCodexQuota.mockResolvedValue(
      codexSnapshot({
        rateLimits: [
          {
            limitId: 'codex',
            limitName: 'Codex',
            primary: { resetsAt: null, usedPercent: 10, windowMinutes: 300 },
            secondary: { resetsAt: null, usedPercent: 20, windowMinutes: 10_080 },
          },
          {
            limitId: 'codex_other',
            limitName: 'Codex Other',
            primary: { resetsAt: null, usedPercent: 98, windowMinutes: 60 },
            secondary: { resetsAt: null, usedPercent: 40, windowMinutes: 43_200 },
          },
        ],
        session: { resetsAt: null, usedPercent: 10, windowMinutes: 300 },
        weekly: { resetsAt: null, usedPercent: 20, windowMinutes: 10_080 },
      }),
    );

    render(<CodexQuotaMenu />);

    expect(await screen.findByText('heteroAgent.quota.compactLeft:80')).toBeTruthy();
    expect(screen.getByText('heteroAgent.codexQuota.fiveHour')).toBeTruthy();
    expect(screen.getByText('heteroAgent.quota.weekly')).toBeTruthy();
    expect(screen.queryByText('Codex Other · heteroAgent.quota.session')).toBeNull();
    expect(screen.queryByText('Codex Other · heteroAgent.codexQuota.monthly')).toBeNull();
    expect(screen.getByText('90%')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.queryByText('2%')).toBeNull();
    expect(screen.queryByText('60%')).toBeNull();
  });

  it('renders the credits-unavailable footer when the RPC omits credits', async () => {
    mockService.getCodexQuota.mockResolvedValue(
      codexSnapshot({ session: { resetsAt: null, usedPercent: 5, windowMinutes: 300 } }),
    );

    render(<CodexQuotaMenu />);

    expect(await screen.findByText('heteroAgent.codexQuota.resetCreditsUnavailable')).toBeTruthy();
  });

  it('renders every available reset with relative expiry only', async () => {
    const now = Date.now();
    mockService.getCodexQuota.mockResolvedValue(
      codexSnapshot({
        rateLimitResetCredits: {
          availableCount: 3,
          credits: [
            {
              expiresAt: now + 3 * 24 * 60 * 60_000,
              grantedAt: now - 24 * 60 * 60_000,
              id: 'credit-later',
              resetType: 'codex_all_limits',
              status: 'available',
              title: 'Weekly rescue',
            },
            {
              expiresAt: now + 24 * 60 * 60_000,
              grantedAt: now - 2 * 24 * 60 * 60_000,
              id: 'credit-first',
              resetType: 'codex_all_limits',
              status: 'available',
              title: 'Early reset',
            },
          ],
          nextExpiresAt: now + 24 * 60 * 60_000,
          totalEarnedCount: 5,
        },
        session: { resetsAt: null, usedPercent: 95, windowMinutes: 300 },
      }),
    );

    render(<CodexQuotaMenu />);

    fireEvent.click(await screen.findByText('heteroAgent.codexQuota.resetCredits:3'));

    expect(await screen.findByText('Early reset')).toBeTruthy();
    expect(screen.getByText('Weekly rescue')).toBeTruthy();
    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.getByText('#2')).toBeTruthy();
    expect(screen.getByText('#3')).toBeTruthy();
    expect(
      screen.getAllByText((text) => text.startsWith('heteroAgent.codexQuota.expiresIn:')),
    ).toHaveLength(2);
    expect(
      screen.queryAllByText((text) => text.startsWith('heteroAgent.codexQuota.expiresAt:')),
    ).toHaveLength(0);
    expect(
      screen.queryAllByText((text) => text.startsWith('heteroAgent.codexQuota.grantedAt:')),
    ).toHaveLength(0);
    expect(screen.getByText('heteroAgent.codexQuota.totalEarned:5')).toBeTruthy();
    expect(screen.getByText('heteroAgent.codexQuota.resetCreditDetailsUnavailable')).toBeTruthy();
    expect(screen.getByText('heteroAgent.codexQuota.resetCreditTitle')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'heteroAgent.codexQuota.resetNow' })).toBeTruthy();
  });

  it('confirms and consumes the earliest-expiring credit, then applies refreshed quota', async () => {
    const now = Date.now();
    mockService.getCodexQuota.mockResolvedValue(
      codexSnapshot({
        rateLimitResetCredits: {
          availableCount: 2,
          credits: [
            {
              expiresAt: now + 2 * 24 * 60 * 60_000,
              grantedAt: now,
              id: 'credit-later',
              resetType: 'codex_all_limits',
              status: 'available',
              title: 'Later reset',
            },
            {
              expiresAt: now + 60 * 60_000,
              grantedAt: now,
              id: 'credit-first',
              resetType: 'codex_all_limits',
              status: 'available',
              title: 'First reset',
            },
          ],
        },
        session: { resetsAt: null, usedPercent: 96, windowMinutes: 300 },
      }),
    );
    mockService.consumeCodexRateLimitResetCredit.mockResolvedValue({
      outcome: 'reset',
      quota: codexSnapshot({
        rateLimitResetCredits: { availableCount: 1 },
        session: { resetsAt: null, usedPercent: 0, windowMinutes: 300 },
      }),
    });

    render(<CodexQuotaMenu command="codex" env={{ CODEX_HOME: '/custom' }} />);

    fireEvent.click(await screen.findByText('heteroAgent.codexQuota.resetCredits:2'));
    fireEvent.click(await screen.findByRole('button', { name: 'heteroAgent.codexQuota.resetNow' }));
    expect(confirmModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'heteroAgent.codexQuota.resetConfirmDescription',
        title: 'heteroAgent.codexQuota.resetConfirmTitle',
      }),
    );

    await act(async () => {
      await confirmModalMock.mock.calls[0][0].onOk();
    });

    await waitFor(() =>
      expect(mockService.consumeCodexRateLimitResetCredit).toHaveBeenCalledWith({
        command: 'codex',
        creditId: 'credit-first',
        env: { CODEX_HOME: '/custom' },
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByText('100%')).toBeTruthy();
    expect(screen.getByText('heteroAgent.codexQuota.resetSuccess')).toBeTruthy();
    expect(toastSuccessMock).toHaveBeenCalledWith('heteroAgent.codexQuota.resetSuccess');
  });

  it('clears refresh loading when a reset supersedes an in-flight quota request', async () => {
    const requests: Array<(snapshot: ElectronClientIpcModule.CodexQuotaSnapshot) => void> = [];
    mockService.getCodexQuota
      .mockResolvedValueOnce(
        codexSnapshot({
          rateLimitResetCredits: { availableCount: 1 },
          session: { resetsAt: null, usedPercent: 96, windowMinutes: 300 },
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ElectronClientIpcModule.CodexQuotaSnapshot>((resolve) => {
            requests.push(resolve);
          }),
      );
    mockService.consumeCodexRateLimitResetCredit.mockResolvedValue({
      outcome: 'reset',
      quota: codexSnapshot({
        rateLimitResetCredits: { availableCount: 0 },
        session: { resetsAt: null, usedPercent: 0, windowMinutes: 300 },
      }),
    });

    render(<CodexQuotaMenu />);

    expect(await screen.findByText('4%')).toBeTruthy();
    fireEvent.click(screen.getByText('heteroAgent.codexQuota.resetCredits:1'));

    fireEvent.click(screen.getByTestId('refresh'));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect((screen.getByTestId('refresh') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'heteroAgent.codexQuota.resetNow' }));

    await act(async () => {
      await confirmModalMock.mock.calls[0][0].onOk();
    });

    expect(await screen.findByText('100%')).toBeTruthy();
    expect((screen.getByTestId('refresh') as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      requests[0](
        codexSnapshot({
          rateLimitResetCredits: { availableCount: 1 },
          session: { resetsAt: null, usedPercent: 80, windowMinutes: 300 },
        }),
      );
    });

    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.queryByText('20%')).toBeNull();
    expect((screen.getByTestId('refresh') as HTMLButtonElement).disabled).toBe(false);
  });
});
