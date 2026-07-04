/**
 * @vitest-environment happy-dom
 */
import type { ClaudeCodeQuotaSnapshot, CodexQuotaSnapshot } from '@lobechat/electron-client-ipc';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ClaudeCodeQuotaMenu from './ClaudeCodeQuotaMenu';
import CodexQuotaMenu from './CodexQuotaMenu';

const mockService = vi.hoisted(() => ({
  getClaudeCodeQuota: vi.fn(),
  getCodexQuota: vi.fn(),
}));

vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: mockService,
}));

// Render keys verbatim (with interpolated values appended) so assertions can
// target the exact i18n key + params a snapshot should produce.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const values = opts ? Object.values(opts) : [];
      return values.length > 0 ? `${key}:${values.join(',')}` : key;
    },
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: (
    create: (utils: { css: (...args: unknown[]) => string }) => Record<string, string>,
  ) => create({ css: () => 'cls' }),
  cssVar: new Proxy({}, { get: (_target, prop) => `var(--${String(prop)})` }),
  cx: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

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
  Popover: ({ children, content }: { children?: ReactNode; content?: ReactNode }) => (
    <div>
      <div data-testid="popover-content">{content}</div>
      {children}
    </div>
  ),
  Skeleton: { Button: () => <div data-testid="skeleton" /> },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const claudeSnapshot = (
  overrides: Partial<ClaudeCodeQuotaSnapshot> = {},
): ClaudeCodeQuotaSnapshot => ({
  error: null,
  provider: 'claude-code',
  scopedWeekly: null,
  session: null,
  status: 'ok',
  updatedAt: Date.now(),
  weekly: null,
  ...overrides,
});

const codexSnapshot = (overrides: Partial<CodexQuotaSnapshot> = {}): CodexQuotaSnapshot => ({
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
  vi.clearAllMocks();
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
    // 100 - usedPercent, session drives the compact trigger label
    expect(screen.getByText('heteroAgent.quota.left:92')).toBeTruthy();
    expect(screen.getByText('heteroAgent.quota.compactLeft:92')).toBeTruthy();
    expect(mockService.getClaudeCodeQuota).toHaveBeenCalledWith({
      env: { CLAUDE_CONFIG_DIR: '/custom' },
    });
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

  it('shows the raw error for error snapshots and refetches on refresh', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValue(
      claudeSnapshot({ error: 'usage API returned 429', status: 'error' }),
    );

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('usage API returned 429')).toBeTruthy();

    fireEvent.click(screen.getByTestId('refresh'));
    expect(mockService.getClaudeCodeQuota).toHaveBeenCalledTimes(2);
  });

  it('renders the empty state when the snapshot has no windows', async () => {
    mockService.getClaudeCodeQuota.mockResolvedValue(claudeSnapshot());

    render(<ClaudeCodeQuotaMenu />);

    expect(await screen.findByText('heteroAgent.quota.noData')).toBeTruthy();
  });
});

describe('CodexQuotaMenu', () => {
  it('renders windows and the reset-credits footer', async () => {
    mockService.getCodexQuota.mockResolvedValue(
      codexSnapshot({
        rateLimitResetCredits: { availableCount: 4, nextExpiresAt: null },
        session: { resetsAt: null, usedPercent: 19, windowMinutes: 300 },
      }),
    );

    render(<CodexQuotaMenu command="codex" />);

    expect(await screen.findByText('heteroAgent.quota.left:81')).toBeTruthy();
    expect(screen.getByText('heteroAgent.codexQuota.resetCredits:4')).toBeTruthy();
    expect(mockService.getCodexQuota).toHaveBeenCalledWith({ command: 'codex', env: undefined });
  });

  it('renders the credits-unavailable footer when the RPC omits credits', async () => {
    mockService.getCodexQuota.mockResolvedValue(
      codexSnapshot({ session: { resetsAt: null, usedPercent: 5, windowMinutes: 300 } }),
    );

    render(<CodexQuotaMenu />);

    expect(await screen.findByText('heteroAgent.codexQuota.resetCreditsUnavailable')).toBeTruthy();
  });
});
