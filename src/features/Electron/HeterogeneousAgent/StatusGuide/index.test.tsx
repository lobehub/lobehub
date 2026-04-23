import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import HeterogeneousAgentStatusGuide from './index';

vi.mock('@lobechat/const', () => ({
  isDesktop: false,
}));

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: () => <span>Claude Code Icon</span>,
  Codex: () => <span>Codex Icon</span>,
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: ({ avatar }: { avatar?: ReactNode }) => <div>{avatar}</div>,
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Highlighter: ({ children, style }: { children?: ReactNode; style?: React.CSSProperties }) => (
    <pre style={style}>{children}</pre>
  ),
  Snippet: ({ children, style }: { children?: ReactNode; style?: React.CSSProperties }) => (
    <pre style={style}>{children}</pre>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd-style', () => ({
  cssVar: {
    colorBgElevated: 'transparent',
    colorFillQuaternary: 'transparent',
  },
}));

vi.mock('lucide-react', () => ({
  ExternalLink: () => <span>ExternalLink Icon</span>,
  Settings2: () => <span>Settings Icon</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'en-US',
      resolvedLanguage: 'en-US',
    },
    t: (
      key: string,
      options?: { count?: number; duration?: string; message?: string; name?: string },
    ) => {
      if (key === 'cliRateLimitGuide.relative.day') {
        return `${options?.count ?? 0} ${(options?.count ?? 0) === 1 ? 'day' : 'days'}`;
      }

      if (key === 'cliRateLimitGuide.relative.hour') {
        return `${options?.count ?? 0} ${(options?.count ?? 0) === 1 ? 'hour' : 'hours'}`;
      }

      if (key === 'cliRateLimitGuide.relative.minute') {
        return `${options?.count ?? 0} ${(options?.count ?? 0) === 1 ? 'minute' : 'minutes'}`;
      }

      if (key === 'cliRateLimitGuide.resetInApprox') {
        return `Resets in about ${options?.duration ?? ''}`;
      }

      return (
        (
          {
            'cliAuthGuide.actions.openDocs': 'Open Sign-in Guide',
            'cliAuthGuide.actions.openSystemTools': 'Open System Tools',
            'cliAuthGuide.afterLogin':
              'After signing in again or refreshing credentials, retry your message.',
            'cliAuthGuide.desc': `${options?.name ?? ''} could not continue because its sign-in session expired or the credentials are invalid.`,
            'cliAuthGuide.errorDetails': 'Error details',
            'cliAuthGuide.runCommand': 'Run this in Terminal',
            'cliAuthGuide.title': `Sign in to ${options?.name ?? ''}`,
            'cliRateLimitGuide.actions.openSystemTools': 'Open System Tools',
            'cliRateLimitGuide.afterReset':
              'Wait until the reset time, then retry your message. If you are using API authorization, you can also check your provider quota and billing status.',
            'cliRateLimitGuide.desc': `${options?.name ?? ''} has reached its current usage limit and cannot continue this run right now.`,
            'cliRateLimitGuide.limitType': 'Limit window',
            'cliRateLimitGuide.limitTypes.weekCycle': 'Week cycle',
            'cliRateLimitGuide.relative.soon': 'Resets soon',
            'cliRateLimitGuide.resetAt': 'Resets at',
            'cliRateLimitGuide.title': `${options?.name ?? ''} usage limit reached`,
            'claudeCodeInstallGuide.actions.openDocs': 'Open Install Guide',
            'claudeCodeInstallGuide.actions.openSystemTools': 'Open System Tools',
            'claudeCodeInstallGuide.afterInstall':
              'After installing, run Claude Code once to sign in, then retry your message.',
            'claudeCodeInstallGuide.desc':
              'Claude Code needs the Claude Code CLI to run locally. Install it first.',
            'claudeCodeInstallGuide.installWithBrew': 'Homebrew',
            'claudeCodeInstallGuide.installWithNpm': 'Recommended install',
            'claudeCodeInstallGuide.reason': `LobeHub could not start Claude Code: ${options?.message ?? ''}`,
            'claudeCodeInstallGuide.title': 'Install Claude Code CLI',
            'codexInstallGuide.actions.openDocs': 'Open Install Guide',
            'codexInstallGuide.actions.openSystemTools': 'Open System Tools',
            'codexInstallGuide.afterInstall':
              'After installing, run Codex once to sign in, then retry your message.',
            'codexInstallGuide.desc':
              'Codex Agent needs the Codex CLI to run locally. Install it first.',
            'codexInstallGuide.installWithBrew': 'Homebrew',
            'codexInstallGuide.installWithNpm': 'Recommended install',
            'codexInstallGuide.reason': `LobeHub could not start Codex: ${options?.message ?? ''}`,
            'codexInstallGuide.title': 'Install Codex CLI',
          } as Record<string, string>
        )[key] || key
      );
    },
  }),
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: {
    openExternalLink: vi.fn(),
  },
}));

describe('HeterogeneousAgentStatusGuide', () => {
  it('hides the duplicated reason for the known cli_not_found state', () => {
    render(
      <HeterogeneousAgentStatusGuide
        error={{
          code: HeterogeneousAgentSessionErrorCode.CliNotFound,
          message: 'Codex CLI was not found',
        }}
      />,
    );

    expect(screen.getByText('Install Codex CLI')).toBeInTheDocument();
    expect(screen.queryByText(/LobeHub could not start Codex:/)).not.toBeInTheDocument();
  });

  it('keeps the detailed reason for unexpected errors', () => {
    render(
      <HeterogeneousAgentStatusGuide
        error={{
          code: 'spawn_failed',
          message: 'Permission denied',
        }}
      />,
    );

    expect(
      screen.getByText('LobeHub could not start Codex: Permission denied'),
    ).toBeInTheDocument();
  });

  it('uses a headerless layout in embedded mode', () => {
    render(<HeterogeneousAgentStatusGuide variant={'embedded'} />);

    expect(screen.queryByText('Install Codex CLI')).not.toBeInTheDocument();
    expect(
      screen.getByText('Codex Agent needs the Codex CLI to run locally. Install it first.'),
    ).toBeInTheDocument();
  });

  it('renders Claude Code install guidance for the Claude CLI flow', () => {
    render(
      <HeterogeneousAgentStatusGuide
        agentType={'claude-code'}
        error={{
          agentType: 'claude-code',
          code: HeterogeneousAgentSessionErrorCode.CliNotFound,
          message: 'Claude Code CLI was not found',
        }}
      />,
    );

    expect(screen.getByText('Install Claude Code CLI')).toBeInTheDocument();
    expect(
      screen.getByText('Claude Code needs the Claude Code CLI to run locally. Install it first.'),
    ).toBeInTheDocument();
    expect(screen.getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeInTheDocument();
    expect(screen.queryByText(/LobeHub could not start Claude Code:/)).not.toBeInTheDocument();
  });

  it('renders sign-in guidance for auth-required errors', () => {
    render(
      <HeterogeneousAgentStatusGuide
        agentType={'claude-code'}
        error={{
          agentType: 'claude-code',
          code: HeterogeneousAgentSessionErrorCode.AuthRequired,
          message: 'Failed to authenticate.\nAPI Error: 401',
        }}
      />,
    );

    expect(screen.getByText('Sign in to Claude Code')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Claude Code could not continue because its sign-in session expired or the credentials are invalid.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Run this in Terminal')).toBeInTheDocument();
    expect(screen.getByText('claude')).toBeInTheDocument();
    expect(screen.getByText('Error details')).toBeInTheDocument();
    const errorDetails = screen.getByText(
      (_, element) => element?.textContent === 'Failed to authenticate.\nAPI Error: 401',
    );
    expect(errorDetails).toBeInTheDocument();
    expect(errorDetails).toHaveStyle({
      maxHeight: '200px',
      overflow: 'auto',
    });
  });

  it('renders rate-limit guidance with structured metadata', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T13:27:00+08:00'));

    try {
      render(
        <HeterogeneousAgentStatusGuide
          agentType={'claude-code'}
          error={{
            agentType: 'claude-code',
            code: HeterogeneousAgentSessionErrorCode.RateLimit,
            message: "You've hit your limit · resets 9am (Asia/Shanghai)",
            rateLimitInfo: {
              rateLimitType: 'seven_day',
              resetsAt: 1_776_992_400,
            },
          }}
        />,
      );

      expect(screen.getByText('Claude Code usage limit reached')).toBeInTheDocument();
      expect(screen.getByText(/Resets in about 19 hours 33 minutes/)).toBeInTheDocument();
      expect(
        screen.getByText(
          'Wait until the reset time, then retry your message. If you are using API authorization, you can also check your provider quota and billing status.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          'Claude Code has reached its current usage limit and cannot continue this run right now.',
        ),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Resets at')).toBeInTheDocument();
      expect(screen.getByText('Limit window')).toBeInTheDocument();
      expect(screen.getByText('Week cycle')).toBeInTheDocument();
      expect(screen.getByText(/Fri 9:00 AM \(Asia\/Shanghai\)/)).toBeInTheDocument();
      expect(screen.getByText(/Asia\/Shanghai/)).toBeInTheDocument();
      expect(screen.queryByText('Open Install Guide')).not.toBeInTheDocument();
      expect(screen.queryByText('Recommended install')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('formats reset time with the active i18n locale instead of the system locale', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T13:27:00+08:00'));

    const dateTimeFormatSpy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(((
      locale?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) => {
      const resolvedLocale = Array.isArray(locale) ? locale[0] : locale;

      return {
        format: () => {
          if (options?.weekday === 'short') {
            return resolvedLocale === 'en-US' ? 'Fri 9:00 AM' : '周五 09:00';
          }

          return resolvedLocale === 'en-US' ? 'Apr 24, 2026, 9:00 AM' : '2026年4月24日 09:00';
        },
        resolvedOptions: () => ({
          calendar: 'gregory',
          locale: resolvedLocale || 'zh-CN',
          numberingSystem: 'latn',
          timeZone: 'Asia/Shanghai',
        }),
      } as Intl.DateTimeFormat;
    }) as typeof Intl.DateTimeFormat);

    try {
      render(
        <HeterogeneousAgentStatusGuide
          agentType={'claude-code'}
          error={{
            agentType: 'claude-code',
            code: HeterogeneousAgentSessionErrorCode.RateLimit,
            message: "You've hit your limit · resets 9am (Asia/Shanghai)",
            rateLimitInfo: {
              rateLimitType: 'seven_day',
              resetsAt: 1_776_992_400,
            },
          }}
        />,
      );

      expect(screen.getByText(/Fri 9:00 AM \(Asia\/Shanghai\)/)).toBeInTheDocument();
      expect(dateTimeFormatSpy).toHaveBeenCalledWith(
        'en-US',
        expect.objectContaining({
          hour: 'numeric',
          minute: '2-digit',
          weekday: 'short',
        }),
      );
    } finally {
      dateTimeFormatSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
