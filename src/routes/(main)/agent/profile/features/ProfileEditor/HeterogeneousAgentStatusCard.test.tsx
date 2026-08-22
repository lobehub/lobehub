import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
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
          defaultCommand: 'claude',
          icon: () => <span>Claude Code Icon</span>,
          title: 'Claude Code',
        }
      : type === 'kimi-code'
        ? {
            defaultCommand: 'kimi',
            icon: () => <span>Kimi Code Icon</span>,
            title: 'Kimi Code',
          }
        : type === 'opencode'
          ? {
              defaultCommand: 'opencode',
              icon: () => <span>OpenCode Icon</span>,
              title: 'OpenCode',
            }
          : type === 'pi'
            ? {
                defaultCommand: 'pi',
                icon: () => <span>Pi Icon</span>,
                title: 'Pi',
              }
            : {
                defaultCommand: 'codex',
                icon: () => <span>Codex Icon</span>,
                title: 'Codex',
              },
  isRemoteHeterogeneousType: (type: string) => ['openclaw', 'hermes'].includes(type),
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

vi.mock('@lobehub/ui/base-ui', () => ({
  Segmented: ({
    disabled,
    onChange,
    options,
  }: {
    disabled?: boolean;
    onChange?: (value: string) => void;
    options: Array<{ disabled?: boolean; label: ReactNode; value: string }>;
  }) => (
    <div>
      {options.map((option) => (
        <button
          disabled={disabled || option.disabled}
          key={option.value}
          type="button"
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    card: 'card',
    label: 'label',
    path: 'path',
  }),
  cssVar: new Proxy({}, { get: (_, key) => `var(--${String(key)})` }),
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
          'heterogeneousStatus.apiMode.enableInLabs': 'Enable in Labs',
          'heterogeneousStatus.apiMode.labDisabled':
            'API authentication is a Labs experiment. Enable it to use a configured provider instead of a Claude subscription.',
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

vi.mock('@/features/HeterogeneousAgent/hooks/useProviderBinding', () => ({
  useProviderBindingCompatibleProviders: () => ({
    modelsByProvider: {
      anthropic: [{ id: 'claude-primary', providerId: 'anthropic' }],
    },
    providers: [{ id: 'anthropic', name: 'Anthropic' }],
  }),
}));

vi.mock('@/features/ModelSelect', () => ({
  default: ({ allowClear, onClear }: { allowClear?: boolean; onClear?: () => void }) => (
    <div>
      Model Select
      {allowClear && (
        <button type="button" onClick={onClear}>
          Clear model
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/services/electron/binary', () => ({
  binaryService: {
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

  it('detects OpenCode and shows its install guide when unavailable', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: false });

    const provider = {
      command: 'opencode',
      type: 'opencode',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
        agentType: 'opencode',
        command: 'opencode',
      });
    });

    expect(screen.getByText('OpenCode CLI')).toBeInTheDocument();
    expect(screen.getByText('OpenCode CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('opencode Install Guide')).toBeInTheDocument();
  });

  it('detects Kimi Code and shows its install guide when unavailable', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: false });

    const provider = {
      command: 'kimi',
      type: 'kimi-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
        agentType: 'kimi-code',
        command: 'kimi',
      });
    });

    expect(screen.getByText('Kimi Code CLI')).toBeInTheDocument();
    expect(screen.getByText('Kimi Code CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('kimi-code Install Guide')).toBeInTheDocument();
  });

  it('detects Pi and shows its install guide when unavailable', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: false });

    const provider = {
      command: 'pi',
      type: 'pi',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
        agentType: 'pi',
        command: 'pi',
      });
    });

    expect(screen.getByText('Pi CLI')).toBeInTheDocument();
    expect(screen.getByText('Pi CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('pi Install Guide')).toBeInTheDocument();
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
    expect(screen.queryByText('Auth Method')).not.toBeInTheDocument();
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

  it('shows API authentication only after the Labs experiment is enabled', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const provider = {
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    const { rerender } = render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard apiModeAvailable provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('claude')).toBeInTheDocument();
    });
    expect(screen.queryByText('Auth Method')).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard apiModeAvailable apiModeLabEnabled provider={provider} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Auth Method')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API' })).toBeEnabled();
  });

  it('keeps leftover API mode visible so the agent can switch back when Labs is off', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    const provider = {
      apiConfig: { model: 'claude-primary', providerId: 'anthropic' },
      authMode: 'api',
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard apiModeAvailable provider={provider} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Auth Method')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API' })).toBeDisabled();
    expect(screen.getByText('Enable in Labs')).toBeInTheDocument();
    expect(screen.queryByText('Model Select')).not.toBeInTheDocument();
  });

  it('persists null when clearing the small-fast model', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    const onApiConfigChange = vi.fn();
    const provider = {
      apiConfig: {
        model: 'claude-primary',
        providerId: 'anthropic',
        smallFastModel: 'claude-fast',
      },
      authMode: 'api',
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          apiModeAvailable
          apiModeLabEnabled
          provider={provider}
          onApiConfigChange={onApiConfigChange}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Clear model' }));

    expect(onApiConfigChange).toHaveBeenCalledWith({
      model: 'claude-primary',
      providerId: 'anthropic',
      smallFastModel: null,
    });
  });
});
