import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import CodexCLIInstallGuide from './index';

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
    t: (key: string, options?: { message?: string; name?: string }) =>
      (
        ({
          'cliAuthGuide.actions.openDocs': 'Open Sign-in Guide',
          'cliAuthGuide.actions.openSystemTools': 'Open System Tools',
          'cliAuthGuide.afterLogin':
            'After signing in again or refreshing credentials, retry your message.',
          'cliAuthGuide.desc': `${options?.name ?? ''} could not continue because its sign-in session expired or the credentials are invalid.`,
          'cliAuthGuide.errorDetails': 'Error details',
          'cliAuthGuide.runCommand': 'Run this in Terminal',
          'cliAuthGuide.title': `Sign in to ${options?.name ?? ''}`,
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
        }) as Record<string, string>
      )[key] || key,
  }),
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: {
    openExternalLink: vi.fn(),
  },
}));

describe('CodexCLIInstallGuide', () => {
  it('hides the duplicated reason for the known cli_not_found state', () => {
    render(
      <CodexCLIInstallGuide
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
      <CodexCLIInstallGuide
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
    render(<CodexCLIInstallGuide variant={'embedded'} />);

    expect(screen.queryByText('Install Codex CLI')).not.toBeInTheDocument();
    expect(
      screen.getByText('Codex Agent needs the Codex CLI to run locally. Install it first.'),
    ).toBeInTheDocument();
  });

  it('renders Claude Code install guidance for the Claude CLI flow', () => {
    render(
      <CodexCLIInstallGuide
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
      <CodexCLIInstallGuide
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
});
