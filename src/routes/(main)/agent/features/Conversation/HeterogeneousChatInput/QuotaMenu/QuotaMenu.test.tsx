/**
 * @vitest-environment happy-dom
 */
import type * as LobechatConstModule from '@lobechat/const';
import type * as ElectronClientIpcModule from '@lobechat/electron-client-ipc';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeteroControlBar from '../HeteroControlBar';
import ClaudeCodeQuotaMenu from './ClaudeCodeQuotaMenu';
import CodexQuotaMenu from './CodexQuotaMenu';

const mockService = vi.hoisted(() => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  getClaudeCodeQuota: vi.fn(),
  getCodexQuota: vi.fn(),
}));

const effectiveAgencyConfig = vi.hoisted(() => ({
  current: {
    boundDeviceId: 'personal-device',
    executionTarget: 'local' as const,
    heterogeneousProvider: { command: 'codex', type: 'codex' as const },
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

vi.mock('@/features/ChatInput/ControlBar/WorkspaceControls', () => ({
  default: () => <div data-testid="workspace-controls" />,
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

// The menu reads persisted quota through TRPC before falling back to the live
// IPC fetch. Default to "nothing persisted yet" so these cases exercise the live
// path without each one stalling on a real HTTP request; individual tests can
// hand it persisted accounts/windows.
const mockQuotaService = vi.hoisted(() => ({
  getWindows: vi.fn(async (): Promise<unknown[]> => []),
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

vi.mock('antd-style', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const mockCssVar = new Proxy({}, { get: (_target, prop) => `var(--${String(prop)})` });
  return {
    ...actual,
    createStaticStyles: (
      create: (utils: {
        css: (...args: unknown[]) => string;
        cssVar: Record<string, string>;
      }) => Record<string, string>,
    ) => create({ css: () => 'cls', cssVar: mockCssVar }),
    cssVar: mockCssVar,
    cx: (...args: unknown[]) => args.filter(Boolean).join(' '),
  };
});

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ disabled, onClick }: { disabled?: boolean; onClick?: () => void }) => (
    <button data-testid="refresh" disabled={disabled} type="button" onClick={onClick} />
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
  Skeleton: { Button: () => <div data-testid="skeleton" /> },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    loading,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled || loading} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  confirmModal: confirmModalMock,
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
  confirmModalMock.mockReset();
  mockService.consumeCodexRateLimitResetCredit.mockReset();
  mockService.getClaudeCodeQuota.mockReset();
  mockService.getCodexQuota.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  mockQuotaService.getWindows.mockResolvedValue([]);
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
    mockQuotaService.getWindows.mockResolvedValue([]);
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
});

describe('CodexQuotaMenu', () => {
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
    expect(screen.getByText('heteroAgent.codexQuota.resetCredits:4')).toBeTruthy();
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

  it('renders every Codex rate-limit bucket and uses the tightest window in the trigger', async () => {
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

    expect(await screen.findByText('heteroAgent.quota.compactLeft:2')).toBeTruthy();
    expect(screen.getByText('heteroAgent.codexQuota.fiveHour')).toBeTruthy();
    expect(screen.getByText('heteroAgent.quota.weekly')).toBeTruthy();
    expect(screen.getByText('Codex Other · heteroAgent.quota.session')).toBeTruthy();
    expect(screen.getByText('Codex Other · heteroAgent.codexQuota.monthly')).toBeTruthy();
    expect(screen.getByText('90%')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('2%')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
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
