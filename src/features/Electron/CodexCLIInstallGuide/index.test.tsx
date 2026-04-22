import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import CodexCLIInstallGuide from './index';

vi.mock('@lobechat/const', () => ({
  isDesktop: false,
}));

vi.mock('@lobehub/icons', () => ({
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
  Snippet: ({ children }: { children?: ReactNode }) => <pre>{children}</pre>,
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
    t: (key: string, options?: { message?: string }) =>
      (
        ({
          'codexInstallGuide.actions.openDocs': 'Open Install Guide',
          'codexInstallGuide.actions.openSystemTools': 'Open System Tools',
          'codexInstallGuide.afterInstall':
            'After installing, run Codex once to sign in, then retry your message.',
          'codexInstallGuide.desc':
            'Codex Agent needs the Codex CLI to run locally. Install it first.',
          'codexInstallGuide.installWithBrew': 'Homebrew (macOS)',
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
});
