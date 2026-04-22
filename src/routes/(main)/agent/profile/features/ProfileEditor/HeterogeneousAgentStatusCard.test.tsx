import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import HeterogeneousAgentStatusCard from './HeterogeneousAgentStatusCard';

const { detectTool, getClaudeAuthStatus } = vi.hoisted(() => ({
  detectTool: vi.fn(),
  getClaudeAuthStatus: vi.fn(),
}));

vi.mock('@lobechat/const', () => ({
  isDesktop: true,
}));

vi.mock('@lobechat/heterogeneous-agents/client', () => ({
  getHeterogeneousAgentClientConfig: (type: string) =>
    type === 'claude-code'
      ? {
          command: 'claude',
          icon: () => <span>Claude Code Icon</span>,
          title: 'Claude Code',
        }
      : {
          command: 'codex',
          icon: () => <span>Codex Icon</span>,
          title: 'Codex',
        },
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick }: { onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      Refresh
    </button>
  ),
  CopyButton: () => <button type="button">Copy</button>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span>Icon</span>,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    styles: {
      card: 'card',
      label: 'label',
      path: 'path',
    },
  }),
}));

vi.mock('lucide-react', () => ({
  CheckCircle2: () => null,
  Loader2Icon: () => null,
  RefreshCw: () => null,
  XCircle: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      (
        ({
          'heterogeneousStatus.detecting': `Detecting ${options?.name ?? ''} CLI`,
          'heterogeneousStatus.redetect': 'Re-detect',
          'heterogeneousStatus.unavailable': `${options?.name ?? ''} CLI is unavailable`,
        }) as Record<string, string>
      )[key] || key,
  }),
}));

vi.mock('@/features/Electron/CodexCLIInstallGuide', () => ({
  default: ({ agentType }: { agentType?: string }) => (
    <div>{`${agentType ?? 'codex'} Install Guide`}</div>
  ),
}));

vi.mock('@/services/electron/toolDetector', () => ({
  toolDetectorService: {
    detectTool,
    getClaudeAuthStatus,
  },
}));

describe('HeterogeneousAgentStatusCard', () => {
  it('shows the embedded Codex install guide when the CLI is unavailable', async () => {
    detectTool.mockResolvedValue({ available: false });
    getClaudeAuthStatus.mockResolvedValue(null);

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
      expect(detectTool).toHaveBeenCalledWith('codex', true);
    });

    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('codex Install Guide')).toBeInTheDocument();
  });

  it('shows the embedded Claude Code install guide when the CLI is unavailable', async () => {
    detectTool.mockResolvedValue({ available: false });
    getClaudeAuthStatus.mockResolvedValue(null);

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
      expect(detectTool).toHaveBeenCalledWith('claude', true);
    });

    expect(screen.getByText('Claude Code CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('claude-code Install Guide')).toBeInTheDocument();
  });
});
