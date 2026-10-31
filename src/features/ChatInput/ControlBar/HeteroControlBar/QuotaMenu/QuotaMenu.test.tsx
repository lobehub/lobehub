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

import { AntigravityQuotaMenu } from './AntigravityQuotaMenu';
import ClaudeCodeQuotaMenu from './ClaudeCodeQuotaMenu';
import CodexQuotaMenu from './CodexQuotaMenu';
import KimiCodeQuotaMenu from './KimiCodeQuotaMenu';
import { createQuotaSourceKey } from './QuotaMenu';
import { claudeSnapshot, codexSnapshot, isolateQuotaReplica, kimiCodeSnapshot } from './testUtils';

const mockService = vi.hoisted(() => ({
  getAntigravityQuota: vi.fn(),
  consumeCodexRateLimitResetCredit: vi.fn(),
  getClaudeCodeQuota: vi.fn(),
  getCodexQuota: vi.fn(),
  getKimiCodeQuota: vi.fn(),
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

const closePopoverMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const factories: ((original: typeof importOriginal) => unknown)[] = [
    async (importOriginal) => {
      return {
        ...(await importOriginal<object>()),
        ActionIcon: ({
          disabled,
          'aria-label': ariaLabel,
          onClick,
          title,
        }: {
          'aria-label'?: string;
          'disabled'?: boolean;
          'onClick'?: () => void;
          'title'?: string;
        }) => (
          <button
            aria-label={ariaLabel ?? title}
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
          aria-label={ariaLabel ?? title}
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
  mockService.getAntigravityQuota.mockReset();
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
  vi.mocked(openQuotaCalendarModal).mockClear();
});

describe('quota panels sharing the account pool', () => {
  it('send one account / binding read when several panels mount together', async () => {
    const live = { session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 } };
    mockService.getClaudeCodeQuota.mockResolvedValue(claudeSnapshot(live));
    mockService.getCodexQuota.mockResolvedValue(codexSnapshot(live));
    mockService.getKimiCodeQuota.mockResolvedValue(kimiCodeSnapshot(live));

    render(
      <>
        <ClaudeCodeQuotaMenu />
        <CodexQuotaMenu />
        <KimiCodeQuotaMenu />
      </>,
    );

    for (const name of ['claudeQuota', 'codexQuota', 'kimiCodeQuota']) {
      const trigger = screen.getByRole('button', { name: `heteroAgent.${name}.tooltip` });
      await waitFor(() => expect(trigger.textContent).toContain('compactLeft:92'));
    }
    expect(mockQuotaService.listAccounts).toHaveBeenCalledTimes(1);
    expect(mockQuotaService.listBindings).toHaveBeenCalledTimes(1);
  });
});

describe('KimiCodeQuotaMenu', () => {
  it('renders native Antigravity groups, unknown buckets and a reset that needs confirmation', async () => {
    const sample = {
      error: null,
      provider: 'antigravity',
      status: 'ok',
      updatedAt: Date.now(),
      groups: [
        {
          name: 'Gemini Models',
          buckets: [
            {
              id: 'weekly',
              name: 'Weekly',
              remainingFraction: 0.939,
              remainingAmount: null,
              resetsAt: Date.now() - 1000,
              disabled: false,
              window: 'weekly',
            },
            {
              id: 'future',
              name: 'Dynamic limit',
              remainingFraction: null,
              remainingAmount: null,
              resetsAt: null,
              disabled: false,
              window: 'dynamic',
            },
          ],
        },
      ],
    };
    mockService.getAntigravityQuota.mockResolvedValue(sample);
    render(<AntigravityQuotaMenu command="/custom/agy" />);
    fireEvent.click(screen.getByRole('button', { name: 'heteroAgent.antigravityQuota.tooltip' }));
    expect(await screen.findByText('Gemini Models')).toBeTruthy();
    expect(screen.getByText('93.9%')).toBeTruthy();
    expect(screen.getByText('heteroAgent.antigravityQuota.unknown')).toBeTruthy();
    expect(screen.getByText('heteroAgent.antigravityQuota.resetUnconfirmed')).toBeTruthy();
    expect(mockService.getAntigravityQuota).toHaveBeenCalledWith({
      command: '/custom/agy',
      env: undefined,
      force: undefined,
    });
    mockService.getAntigravityQuota.mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'heteroAgent.quota.refresh' }));
    expect(await screen.findByText('heteroAgent.antigravityQuota.error')).toBeTruthy();
    expect(screen.getByText('93.9%')).toBeTruthy();
  });

  it('renders all four windows and the Extra Usage footer from the snapshot', async () => {
    mockService.getKimiCodeQuota.mockResolvedValue(
      kimiCodeSnapshot({
        extraUsage: {
          balanceCents: 1234,
          currency: 'USD',
          monthlyChargeLimitCents: 5000,
          monthlyChargeLimitEnabled: true,
          monthlyUsedCents: 42,
          totalCents: 2000,
        },
        monthly: { resetsAt: null, usedPercent: 55, windowMinutes: 43_200 },
        monthlyCode: { resetsAt: null, usedPercent: 61, windowMinutes: 43_200 },
        session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
        weekly: { resetsAt: null, usedPercent: 13, windowMinutes: 10_080 },
      }),
    );

    render(<KimiCodeQuotaMenu />);

    expect(await screen.findByText('heteroAgent.kimiCodeQuota.fiveHour')).toBeTruthy();
    expect(screen.getByText('heteroAgent.quota.weekly')).toBeTruthy();
    expect(screen.getByText('heteroAgent.kimiCodeQuota.monthly')).toBeTruthy();
    expect(screen.getByText('heteroAgent.kimiCodeQuota.monthlyCode')).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.getByText('39%')).toBeTruthy();
    expect(screen.getByText('heteroAgent.kimiCodeQuota.extraUsage')).toBeTruthy();
    expect(
      screen.getByText((content) => content.startsWith('heteroAgent.kimiCodeQuota.monthlyCap:')),
    ).toBeTruthy();
    // The trigger compacts every window into the tightest remaining value.
    const trigger = screen.getByRole('button', { name: 'heteroAgent.kimiCodeQuota.tooltip' });
    expect(trigger.textContent).toContain('heteroAgent.quota.compactLeft:39');
    expect(mockService.getKimiCodeQuota).toHaveBeenCalledWith({ env: undefined });
  });

  it('paints the last snapshot on a remount before the sampler answers', async () => {
    const live = { session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 } };
    mockService.getKimiCodeQuota.mockResolvedValueOnce(kimiCodeSnapshot(live));
    const badge = () => screen.getByRole('button', { name: 'heteroAgent.kimiCodeQuota.tooltip' });
    const first = render(<KimiCodeQuotaMenu />);
    await waitFor(() => expect(badge().textContent).toContain('compactLeft:92'));
    first.unmount();

    // The next sample never answers: the badge can only come from the replica.
    mockService.getKimiCodeQuota.mockImplementation(() => new Promise(() => {}));
    render(<KimiCodeQuotaMenu />);
    await waitFor(() => expect(badge().textContent).toContain('compactLeft:92'));
  });

  it('keeps the stored snapshot when a reload samples an error before hydration', async () => {
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    const storage = quotaPanelResource.storage!;
    const sourceKey = createQuotaSourceKey('kimi-code', 'agent-1', undefined, undefined);
    await storage.set(
      { queryKey: hashQuotaSourceKey(sourceKey), scope: cacheScope.get() },
      {
        data: kimiCodeSnapshot({
          session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
        }),
        updatedAt: 1,
      },
    );

    // Cold reload, offline: the sampler fails while IndexedDB is still answering.
    let releaseStorage!: () => void;
    const storageReady = new Promise<void>((resolve) => {
      releaseStorage = resolve;
    });
    const read = storage.get.bind(storage);
    vi.spyOn(storage, 'get').mockImplementation(async (key) => {
      await storageReady;
      return read(key);
    });
    mockService.getKimiCodeQuota.mockRejectedValue(new Error('offline'));
    const badge = () => screen.getByRole('button', { name: 'heteroAgent.kimiCodeQuota.tooltip' });

    render(<KimiCodeQuotaMenu />);
    await waitFor(() => expect(mockService.getKimiCodeQuota).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    releaseStorage();

    await waitFor(() => expect(badge().textContent).toContain('compactLeft:92'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    vi.mocked(storage.get).mockRestore();
    expect(
      await storage.get({ queryKey: hashQuotaSourceKey(sourceKey), scope: cacheScope.get() }),
    ).toMatchObject({ data: { session: { usedPercent: 8 }, status: 'ok' } });
  });

  it('omits the monthly cap line when the charge limit is disabled', async () => {
    mockService.getKimiCodeQuota.mockResolvedValue(
      kimiCodeSnapshot({
        extraUsage: {
          balanceCents: 1234,
          currency: 'USD',
          monthlyChargeLimitCents: 0,
          monthlyChargeLimitEnabled: false,
          monthlyUsedCents: 42,
          totalCents: 2000,
        },
        session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
      }),
    );

    render(<KimiCodeQuotaMenu />);

    expect(await screen.findByText('heteroAgent.kimiCodeQuota.extraUsage')).toBeTruthy();
    expect(
      screen.queryByText((content) => content.startsWith('heteroAgent.kimiCodeQuota.monthlyCap')),
    ).toBeNull();
  });

  it('maps unavailable reasons to their localized explanations', async () => {
    mockService.getKimiCodeQuota.mockResolvedValue(
      kimiCodeSnapshot({ reason: 'credentials-not-found', status: 'unavailable' }),
    );

    render(<KimiCodeQuotaMenu />);

    expect(await screen.findByText('heteroAgent.kimiCodeQuota.unavailableNotFound')).toBeTruthy();
  });

  it('opens the usage calendar for the kimi-code account from the header switcher', async () => {
    mockService.getKimiCodeQuota.mockResolvedValue(
      kimiCodeSnapshot({
        identity: { displayName: 'Kimi User', externalAccountId: 'kimi-ext-1' },
        session: { resetsAt: null, usedPercent: 20, windowMinutes: 300 },
      }),
    );

    render(<KimiCodeQuotaMenu />);

    fireEvent.click(await screen.findByTestId('calendar'));

    expect(closePopoverMock).toHaveBeenCalledTimes(1);
    expect(openQuotaCalendarModal).toHaveBeenCalledWith({
      externalAccountId: 'kimi-ext-1',
      provider: 'kimi-code',
    });
  });
});

describe('CodexQuotaMenu', () => {
  it('opens the usage calendar for the codex account from the header switcher', async () => {
    mockService.getCodexQuota.mockResolvedValue(
      codexSnapshot({
        identity: { displayName: 'Codex User', externalAccountId: 'codex-ext-1' },
        session: { resetsAt: null, usedPercent: 19, windowMinutes: 300 },
      }),
    );

    render(<CodexQuotaMenu command="codex" />);

    fireEvent.click(await screen.findByTestId('calendar'));

    expect(closePopoverMock).toHaveBeenCalledTimes(1);
    expect(openQuotaCalendarModal).toHaveBeenCalledWith({
      externalAccountId: 'codex-ext-1',
      provider: 'codex',
    });
  });

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
