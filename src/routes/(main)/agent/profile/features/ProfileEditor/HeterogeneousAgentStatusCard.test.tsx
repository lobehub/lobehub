import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import HeterogeneousAgentStatusCard from './HeterogeneousAgentStatusCard';

const { detectHeterogeneousAgentCommand, getClaudeAuthStatus } = vi.hoisted(() => ({
  detectHeterogeneousAgentCommand: vi.fn(),
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
  ActionIcon: ({
    'aria-label': ariaLabel,
    className,
    onClick,
  }: {
    'aria-label'?: string;
    'className'?: string;
    'onClick'?: () => void;
  }) => (
    <button aria-label={ariaLabel} className={className} type="button" onClick={onClick}>
      Refresh
    </button>
  ),
  CopyButton: () => <button type="button">Copy</button>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span>Icon</span>,
  Input: ({
    onBlur,
    onChange,
    onKeyDown,
    placeholder,
    ref,
    value,
  }: {
    onBlur?: () => void;
    onChange?: (event: { target: { value: string } }) => void;
    onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
    placeholder?: string;
    ref?: React.Ref<HTMLInputElement>;
    value?: string;
  }) => (
    <input
      placeholder={placeholder}
      ref={ref}
      value={value}
      onBlur={onBlur}
      onChange={(event) => {
        onChange?.({ target: { value: event.target.value } });
      }}
      onKeyDown={(event) => {
        onKeyDown?.({ key: event.key, preventDefault: () => event.preventDefault() });
      }}
    />
  ),
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
  PencilLine: () => null,
  RefreshCw: () => null,
  XCircle: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      (
        ({
          'heterogeneousStatus.account.label': 'Account',
          'heterogeneousStatus.auth.api': 'API',
          'heterogeneousStatus.auth.label': 'Auth Method',
          'heterogeneousStatus.auth.subscription': 'Subscription',
          'heterogeneousStatus.command.edit': 'Edit command',
          'heterogeneousStatus.command.label': 'Command',
          'heterogeneousStatus.command.placeholder': 'Command name or absolute path',
          'heterogeneousStatus.detecting': `Detecting ${options?.name ?? ''} CLI`,
          'heterogeneousStatus.plan.label': 'Plan',
          'heterogeneousStatus.redetect': 'Re-detect',
          'heterogeneousStatus.unavailable': `${options?.name ?? ''} CLI is unavailable`,
        }) as Record<string, string>
      )[key] || key,
  }),
}));

vi.mock('@/features/Electron/HeterogeneousAgent/StatusGuide', () => ({
  default: ({ agentType }: { agentType?: string }) => (
    <div>{`${agentType ?? 'codex'} Install Guide`}</div>
  ),
}));

vi.mock('@/services/electron/toolDetector', () => ({
  toolDetectorService: {
    detectHeterogeneousAgentCommand,
    getClaudeAuthStatus,
  },
}));

describe('HeterogeneousAgentStatusCard', () => {
  it('shows the embedded Codex install guide when the CLI is unavailable', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: false });
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
      expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
        agentType: 'codex',
        command: 'codex',
      });
    });

    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('codex Install Guide')).toBeInTheDocument();
    expect(screen.getByText('codex')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('codex')).not.toBeInTheDocument();
  });

  it('shows the embedded Claude Code install guide when the CLI is unavailable', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: false });
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
      expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
        agentType: 'claude-code',
        command: 'claude',
      });
    });

    expect(screen.getByText('Claude Code CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('claude-code Install Guide')).toBeInTheDocument();
  });

  it('detects and queries auth with the customized Claude command', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({
      available: true,
      path: '/Users/test/bin/claude-alt',
      version: '2.1.118 (Claude Code)',
    });
    getClaudeAuthStatus.mockResolvedValue({
      apiProvider: 'firstParty',
      authMethod: 'claude.ai',
      email: 'test@example.com',
      loggedIn: true,
      subscriptionType: 'max',
    });

    const provider = {
      command: 'claude-alt',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
        agentType: 'claude-code',
        command: 'claude-alt',
      });
    });

    await waitFor(() => {
      expect(getClaudeAuthStatus).toHaveBeenCalledWith('claude-alt');
    });

    expect(screen.getByText('claude-alt')).toBeInTheDocument();
    expect(screen.getByText('Auth Method')).toBeInTheDocument();
    expect(screen.getByText('Subscription')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('MAX')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('hides the install guide when a customized command is unavailable', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: false });
    getClaudeAuthStatus.mockResolvedValue(null);

    const provider = {
      command: 'claude-alt',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Claude Code CLI is unavailable')).toBeInTheDocument();
    });

    expect(screen.queryByText('claude-code Install Guide')).not.toBeInTheDocument();
    expect(screen.getByText('claude-alt')).toBeInTheDocument();
  });

  it('persists command edits on blur', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const onCommandChange = vi.fn();

    const provider = {
      command: 'codex',
      type: 'codex',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} onCommandChange={onCommandChange} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit command' }));

    const input = await screen.findByDisplayValue('codex');
    fireEvent.change(input, { target: { value: 'codex-alt' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onCommandChange).toHaveBeenCalledWith('codex-alt');
    });
  });

  it('keeps the command read-only until edit mode is activated', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
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

    expect(await screen.findByText('claude')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('claude')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit command' }));

    expect(await screen.findByDisplayValue('claude')).toBeInTheDocument();
  });
});
