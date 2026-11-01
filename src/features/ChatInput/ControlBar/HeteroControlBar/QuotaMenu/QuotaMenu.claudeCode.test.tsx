/**
 * @vitest-environment happy-dom
 */
import type * as LobechatConstModule from '@lobechat/const';
import type * as ElectronClientIpcModule from '@lobechat/electron-client-ipc';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openQuotaCalendarModal } from '@/features/AgentQuotaCalendar';
import { cacheScope } from '@/libs/replica';
import { hashQuotaSourceKey, quotaPanelResource } from '@/store/agentQuota/projection';
import { useElectronStore } from '@/store/electron';

import ClaudeCodeQuotaMenu from './ClaudeCodeQuotaMenu';
import { createQuotaSourceKey } from './QuotaMenu';
import {
  claudeSnapshot,
  isolateQuotaReplica,
  liveSessionReading,
  persistedAccount,
  persistedSessionReading,
  waitForQuotaIdle,
} from './testUtils';

const mockService = vi.hoisted(() => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  getClaudeCodeQuota: vi.fn(),
  getCodexQuota: vi.fn(),
  getKimiCodeQuota: vi.fn(),
  listClaudeCodeAccounts: vi.fn(async () => [] as unknown[]),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobechatConstModule>()),
  isDesktop: true,
}));

vi.mock('@lobechat/electron-client-ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof ElectronClientIpcModule>()),
  useWatchBroadcast: vi.fn(),
}));

vi.mock('@/features/AgentQuotaCalendar', () => ({
  openQuotaCalendarModal: vi.fn(),
}));

vi.mock('@/features/ChatInput/hooks/useAgentId', () => ({ useAgentId: () => 'agent-1' }));

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
  getDeviceAccount: vi.fn(async (): Promise<{ accountId: string | null }> => ({ accountId: null })),
  getLatestReadings: vi.fn(async (_accountId?: string): Promise<unknown[]> => []),
  ingestClaudeSnapshot: vi.fn(async () => undefined),
  ingestCodexSnapshot: vi.fn(async () => undefined),
  ingestKimiCodeSnapshot: vi.fn(async () => undefined),
  refreshCodexQuota: vi.fn(),
  refreshKimiCodeQuota: vi.fn(),
  listAccounts: vi.fn(async (): Promise<unknown[]> => []),
  listBindings: vi.fn(async (): Promise<unknown[]> => []),
  syncDeviceLogins: vi.fn(async () => undefined),
}));

vi.mock('@/services/agentQuota', () => ({ agentQuotaService: mockQuotaService }));

// Render keys verbatim (with interpolated values appended) so assertions can
// target the exact i18n key + params a snapshot should produce.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

const closePopoverMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const factories: ((original: typeof importOriginal) => unknown)[] = [
    async (importOriginal) => {
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
        Skeleton: { Button: () => <div data-testid="skeleton" /> },
        Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
        Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
      };
    },
    async (importOriginal) => ({
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
    }),
  ];
  const merged: Record<string, unknown> = { ...actual };
  for (const factory of factories) {
    const part = (await factory(importOriginal)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(part)) if (value !== actual[key]) merged[key] = value;
  }
  // The mocked Popover has no provider; the header switcher closes it before opening modals.
  merged.usePopoverContext = () => ({ close: closePopoverMock });
  return merged;
});

beforeEach(() => {
  closePopoverMock.mockReset();
  isolateQuotaReplica();
  confirmModalMock.mockReset();
  mockService.consumeCodexRateLimitResetCredit.mockReset();
  mockService.getClaudeCodeQuota.mockReset();
  mockService.getCodexQuota.mockReset();
  mockService.getKimiCodeQuota.mockReset();
  mockLambdaClaudeQuota.mockReset();
  mockLambdaCodexQuota.mockReset();
  mockLambdaKimiCodeQuota.mockReset();
  mockQuotaService.refreshCodexQuota.mockImplementation(mockLambdaCodexQuota);
  mockQuotaService.refreshKimiCodeQuota.mockImplementation(mockLambdaKimiCodeQuota);
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  mockQuotaService.getLatestReadings.mockResolvedValue([]);
  mockQuotaService.ingestClaudeSnapshot.mockClear();
  mockQuotaService.ingestKimiCodeSnapshot.mockClear();
  mockQuotaService.listAccounts.mockClear().mockResolvedValue([]);
  mockQuotaService.listBindings.mockClear().mockResolvedValue([]);
  mockQuotaService.getDeviceAccount.mockClear().mockResolvedValue({ accountId: null });
  vi.mocked(openQuotaCalendarModal).mockClear();
});

describe('ClaudeCodeQuotaMenu', () => {
  it('opens the usage calendar for the claude-code account from the header switcher', async () => {
    mockQuotaService.listAccounts.mockResolvedValue([persistedAccount(Date.now() - 60_000)]);
    mockQuotaService.getLatestReadings.mockResolvedValue([
      persistedSessionReading(Date.now() - 60_000),
    ]);

    render(<ClaudeCodeQuotaMenu />);

    fireEvent.click(await screen.findByTestId('calendar'));

    expect(closePopoverMock).toHaveBeenCalledTimes(1);
    expect(openQuotaCalendarModal).toHaveBeenCalledWith({
      externalAccountId: 'ext-1',
      provider: 'claude-code',
    });
  });

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

  it('samples every local login on refresh, so Auto balances on fresh readings', async () => {
    // Auto may route to a profile login the panel is not showing.
    mockService.listClaudeCodeAccounts.mockResolvedValueOnce([
      { configDir: null, identity: { externalAccountId: 'ext-default' } },
      { configDir: '/profiles/work', identity: { externalAccountId: 'ext-work' } },
    ]);
    mockService.getClaudeCodeQuota.mockResolvedValue(claudeSnapshot({ status: 'unavailable' }));

    render(<ClaudeCodeQuotaMenu />);

    await waitFor(() =>
      expect(mockService.getClaudeCodeQuota).toHaveBeenCalledWith(
        expect.objectContaining({ env: { CLAUDE_CONFIG_DIR: '/profiles/work' } }),
      ),
    );
  });

  it('keeps the account manager reachable when the sample is unavailable', async () => {
    // e.g. the usage API is blocked on this network: adding or switching an
    // account must not depend on a reading existing.
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({ reason: 'request-blocked', status: 'unavailable' }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(
      await screen.findByText('heteroAgent.claudeQuota.unavailableRequestBlocked'),
    ).toBeTruthy();
    expect(screen.getByText('heteroAgent.claudeQuota.manage.entry')).toBeTruthy();
  });

  it('explains a network-blocked sample instead of reporting an expired login', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({ error: 'blocked (403)', reason: 'request-blocked', status: 'unavailable' }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(
      await screen.findByText('heteroAgent.claudeQuota.unavailableRequestBlocked'),
    ).toBeTruthy();
    expect(screen.queryByText('heteroAgent.claudeQuota.unavailableExpired')).toBeNull();
  });

  it('keeps the unavailable explanation on screen while a retry is in flight', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValueOnce(
      claudeSnapshot({ error: 'expired', reason: 'credentials-expired', status: 'unavailable' }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('heteroAgent.claudeQuota.unavailableExpired')).toBeTruthy();

    mockService.getClaudeCodeQuota.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByTestId('refresh'));

    await waitFor(() => expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(2));
    expect((screen.getByTestId('refresh') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('skeleton')).toBeNull();
    expect(screen.getByText('heteroAgent.claudeQuota.unavailableExpired')).toBeTruthy();
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

  // Regression: a pick whose account was then disabled for the agent kept the
  // panel on that account, though runs no longer use it.
  it('does not show a device pick whose account left the agent rotation', async () => {
    const now = Date.now() - 60_000;
    mockQuotaService.listAccounts.mockResolvedValue([
      persistedAccount(now),
      { ...persistedAccount(now), externalAccountId: 'ext-2', id: 'acc-2' },
    ]);
    mockQuotaService.listBindings.mockResolvedValue([
      { accountId: 'acc-1', agentId: 'agent-1', enabled: true, id: 'b1', role: 'pool' },
      { accountId: 'acc-2', agentId: 'agent-1', enabled: true, id: 'b2', role: 'disabled' },
    ]);
    mockQuotaService.getDeviceAccount.mockResolvedValue({ accountId: 'acc-2' });
    mockQuotaService.getLatestReadings.mockImplementation(async (accountId?: string) => [
      { ...persistedSessionReading(now), utilization: accountId === 'acc-2' ? 50 : 8 },
    ]);
    vi.spyOn(useElectronStore.getState(), 'resolveGatewayDeviceId').mockResolvedValue('device-a');

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('92%')).toBeTruthy();
    expect(mockQuotaService.getDeviceAccount).toHaveBeenCalledWith('agent-1', 'device-a');
    expect(screen.queryByText('50%')).toBeNull();
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

  it('explains a blocked live refresh under the persisted windows it could not update', async () => {
    mockQuotaService.listAccounts.mockResolvedValue([persistedAccount(Date.now() - 31 * 60_000)]);
    mockQuotaService.getLatestReadings.mockResolvedValue([
      persistedSessionReading(Date.now() - 31 * 60_000),
    ]);
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({ error: 'blocked (403)', reason: 'request-blocked', status: 'unavailable' }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(
      await screen.findByText('heteroAgent.claudeQuota.unavailableRequestBlocked'),
    ).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
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
    await waitForQuotaIdle();
    expect(mockService.getClaudeCodeQuota).not.toHaveBeenCalled();

    // …but regaining focus revalidates (the main-process cache rate-limits it).
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(1));
    expect(mockService.getClaudeCodeQuota).toHaveBeenCalledWith({ env: undefined });
  });

  it('samples through the device gateway RPC when a deviceId is provided', async () => {
    mockLambdaClaudeQuota.mockResolvedValue(
      claudeSnapshot({ session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 } }),
    );

    render(<ClaudeCodeQuotaMenu deviceId="remote-device" />);

    await waitFor(() =>
      expect(mockLambdaClaudeQuota).toHaveBeenCalledWith({
        deviceId: 'remote-device',
        env: undefined,
      }),
    );
    expect(await screen.findByText('92%')).toBeTruthy();
    expect(mockService.getClaudeCodeQuota).not.toHaveBeenCalled();
  });

  it('keeps the stored snapshot when a cold load of a device fails to sample', async () => {
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    const storage = quotaPanelResource.storage!;
    const sourceKey = createQuotaSourceKey('claude-code', 'agent-1', 'remote-device', undefined);
    const row = { queryKey: hashQuotaSourceKey(sourceKey), scope: cacheScope.get() };
    await storage.set(row, {
      data: claudeSnapshot({ session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 } }),
      updatedAt: 1,
    });
    // No trusted device account yet on a cold load, and the device RPC fails.
    mockLambdaClaudeQuota.mockRejectedValue(new Error('device offline'));

    render(<ClaudeCodeQuotaMenu deviceId="remote-device" />);

    await waitFor(() => expect(mockLambdaClaudeQuota).toHaveBeenCalled());
    await waitForQuotaIdle();
    await waitFor(() => expect(screen.getAllByText('92%').length).toBeGreaterThan(0));
    expect(screen.queryByText('heteroAgent.quota.unavailable')).toBeNull();
    expect(await storage.get(row)).toMatchObject({ data: { status: 'ok' } });
  });

  it('does not reuse another device account when the newly selected device is unavailable', async () => {
    const capturedAt = Date.now();
    const account = persistedAccount();
    mockQuotaService.listAccounts.mockResolvedValue([account]);
    mockQuotaService.getLatestReadings.mockResolvedValue([persistedSessionReading(capturedAt)]);
    mockLambdaClaudeQuota.mockResolvedValueOnce(
      claudeSnapshot({
        identity: { externalAccountId: 'ext-1' },
        readings: [liveSessionReading(capturedAt)],
      }),
    );

    const { rerender } = render(<ClaudeCodeQuotaMenu deviceId="device-a" />);
    expect(await screen.findByText('92%')).toBeTruthy();

    mockLambdaClaudeQuota.mockResolvedValueOnce(null);
    rerender(<ClaudeCodeQuotaMenu deviceId="device-b" />);

    await waitFor(() =>
      expect(mockLambdaClaudeQuota).toHaveBeenLastCalledWith({
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
    await waitForQuotaIdle();

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
    await waitForQuotaIdle();

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
    await waitForQuotaIdle();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(1);
  });
});
