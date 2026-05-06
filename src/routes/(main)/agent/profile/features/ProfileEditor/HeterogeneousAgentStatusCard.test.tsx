import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeterogeneousAgentStatusCard from './HeterogeneousAgentStatusCard';

const { checkClaudeCodeApiConnection, detectHeterogeneousAgentCommand, getClaudeAuthStatus } =
  vi.hoisted(() => ({
    checkClaudeCodeApiConnection: vi.fn(),
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

vi.mock('@lobehub/icons', () => ({
  getLobeIconCDN: (id: string) => `https://icons.test/${id.toLowerCase()}.webp`,
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    className,
    disabled,
    onClick,
  }: {
    'aria-label'?: string;
    'className'?: string;
    'disabled'?: boolean;
    'onClick'?: () => void;
  }) => (
    <button
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
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
    type,
    value,
  }: {
    disabled?: boolean;
    onBlur?: () => void;
    onChange?: (event: { target: { value: string } }) => void;
    onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
    placeholder?: string;
    ref?: React.Ref<HTMLInputElement>;
    type?: string;
    value?: string;
  }) => (
    <input
      placeholder={placeholder}
      ref={ref}
      type={type}
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
  Segmented: ({
    onChange,
    options,
    value,
  }: {
    onChange?: (value: string) => void;
    options?: Array<{ label: string; value: string }>;
    value?: string;
  }) => (
    <div>
      {options?.map((option) => (
        <button
          aria-pressed={value === option.value}
          key={option.value}
          type="button"
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  Select: ({
    'aria-label': ariaLabel,
    onChange,
    options,
    value,
  }: {
    'aria-label'?: string;
    'onChange'?: (value: string) => void;
    'options'?: Array<{ label: string; value: string }>;
    'value'?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Select: ({
    'aria-label': ariaLabel,
    onChange,
    options,
    value,
  }: {
    'aria-label'?: string;
    'onChange'?: (value: string) => void;
    'options'?: Array<{ label: string; value: string }>;
    'value'?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
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
  PlusIcon: () => null,
  RefreshCw: () => null,
  SaveIcon: () => null,
  Trash2Icon: () => null,
  XCircle: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: { keys?: string; latency?: number | string; message?: string; name?: string },
    ) =>
      (
        ({
          'heterogeneousStatus.account.label': 'Account',
          'heterogeneousStatus.auth.api': 'API',
          'heterogeneousStatus.auth.label': 'Auth Method',
          'heterogeneousStatus.auth.subscription': 'Subscription',
          'heterogeneousStatus.billing.api': 'API Billing',
          'heterogeneousStatus.billing.apiDesc':
            'Uses Anthropic-compatible environment variables for this agent.',
          'heterogeneousStatus.billing.label': 'Billing',
          'heterogeneousStatus.billing.subscription': 'Subscription',
          'heterogeneousStatus.billing.subscriptionDesc':
            'Uses the signed-in Claude Code subscription account.',
          'heterogeneousStatus.command.edit': 'Edit command',
          'heterogeneousStatus.command.label': 'Command',
          'heterogeneousStatus.command.placeholder': 'Command name or absolute path',
          'heterogeneousStatus.detecting': `Detecting ${options?.name ?? ''} CLI`,
          'heterogeneousStatus.env.add': 'Add environment variable',
          'heterogeneousStatus.env.cancel': 'Cancel environment changes',
          'heterogeneousStatus.env.checkConnection': 'Test connection',
          'heterogeneousStatus.env.checkFailed': `Connection failed: ${options?.message ?? ''}`,
          'heterogeneousStatus.env.checkSuccess': 'Connection successful',
          'heterogeneousStatus.env.checkSuccessWithLatency': `Connection successful (${
            options?.latency ?? ''
          } ms)`,
          'heterogeneousStatus.env.count': '1 env var',
          'heterogeneousStatus.env.count_other': '2 env vars',
          'heterogeneousStatus.env.edit': 'Edit environment variables',
          'heterogeneousStatus.env.empty': 'No custom environment variables',
          'heterogeneousStatus.env.keyPlaceholder': 'Variable name',
          'heterogeneousStatus.env.label': 'Environment',
          'heterogeneousStatus.env.preset': 'Provider preset',
          'heterogeneousStatus.env.presetHint':
            'Preset fills Claude Code compatible environment variables; edit values before saving.',
          'heterogeneousStatus.env.remove': 'Remove environment variable',
          'heterogeneousStatus.env.required': `Required for API billing: ${options?.keys ?? ''}`,
          'heterogeneousStatus.env.save': 'Save environment variables',
          'heterogeneousStatus.env.valuePlaceholder': 'Value',
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

vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: {
    checkClaudeCodeApiConnection,
  },
}));

describe('HeterogeneousAgentStatusCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    expect(screen.getAllByText('Subscription').length).toBeGreaterThan(0);
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('MAX')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('hides Claude subscription auth metadata in API billing mode', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({
      available: true,
      path: '/Users/test/bin/claude',
      version: '2.1.118 (Claude Code)',
    });
    getClaudeAuthStatus.mockResolvedValue({
      apiProvider: 'firstParty',
      authMethod: 'claude.ai',
      email: 'i@innei.dev',
      loggedIn: true,
      subscriptionType: 'max',
    });

    const provider = {
      billingType: 'api',
      command: 'claude',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'kimi-token',
        ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
      },
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

    expect(getClaudeAuthStatus).not.toHaveBeenCalled();
    expect(screen.getByText('API Billing')).toBeInTheDocument();
    expect(screen.queryByText('Auth Method')).not.toBeInTheDocument();
    expect(screen.queryByText('i@innei.dev')).not.toBeInTheDocument();
    expect(screen.queryByText('Plan')).not.toBeInTheDocument();
    expect(screen.queryByText('MAX')).not.toBeInTheDocument();
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

  it('persists per-agent environment edits', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const onEnvChange = vi.fn();

    const provider = {
      billingType: 'api',
      command: 'claude',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'old-token',
        ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
      },
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} onEnvChange={onEnvChange} />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/ANTHROPIC_BASE_URL/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit environment variables' }));

    fireEvent.change(screen.getByDisplayValue('old-token'), {
      target: { value: 'kimi-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save environment variables' }));

    await waitFor(() => {
      expect(onEnvChange).toHaveBeenCalledWith({
        ANTHROPIC_AUTH_TOKEN: 'kimi-token',
        ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
      });
    });
  });

  it('shows API billing mode as requiring Anthropic environment variables', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const onBillingTypeChange = vi.fn();

    const provider = {
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          provider={provider}
          onBillingTypeChange={onBillingTypeChange}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Subscription')).toBeInTheDocument();
    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByText('No custom environment variables')).toBeInTheDocument();

    fireEvent.click(screen.getByText('API Billing'));

    await waitFor(() => {
      expect(onBillingTypeChange).toHaveBeenCalledWith('api');
    });

    expect(screen.getByDisplayValue('ANTHROPIC_AUTH_TOKEN')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ANTHROPIC_BASE_URL')).toBeInTheDocument();
  });

  it('allows custom environment variables in Claude subscription billing mode', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const onEnvChange = vi.fn();

    const provider = {
      billingType: 'subscription',
      command: 'claude',
      env: {
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} onEnvChange={onEnvChange} />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit environment variables' }));

    expect(screen.queryByRole('combobox', { name: 'Provider preset' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('1'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save environment variables' }));

    await waitFor(() => {
      expect(onEnvChange).toHaveBeenCalledWith({
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0',
      });
    });
  });

  it('applies Claude Code API provider presets to environment rows', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const onEnvChange = vi.fn();

    const provider = {
      billingType: 'api',
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} onEnvChange={onEnvChange} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit environment variables' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Provider preset' }), {
      target: { value: 'deepseek' },
    });

    expect(screen.getByDisplayValue('https://api.deepseek.com/anthropic')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('deepseek-v4-pro').length).toBeGreaterThan(0);

    const tokenValueInput = screen
      .getByDisplayValue('ANTHROPIC_AUTH_TOKEN')
      .parentElement?.querySelector('input[placeholder="Value"]');
    expect(tokenValueInput).toBeTruthy();

    fireEvent.change(tokenValueInput!, {
      target: { value: 'deepseek-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save environment variables' }));

    await waitFor(() => {
      expect(onEnvChange).toHaveBeenCalledWith(
        expect.objectContaining({
          ANTHROPIC_AUTH_TOKEN: 'deepseek-token',
          ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
          ANTHROPIC_MODEL: 'deepseek-v4-pro',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          DISABLE_TELEMETRY: '1',
        }),
      );
    });
  });

  it('notifies preset changes only after environment edits are saved', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const onProviderPresetChange = vi.fn();
    const onEnvChange = vi.fn();

    const provider = {
      billingType: 'api',
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          provider={provider}
          onEnvChange={onEnvChange}
          onProviderPresetChange={onProviderPresetChange}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit environment variables' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Provider preset' }), {
      target: { value: 'deepseek' },
    });
    fireEvent.change(screen.getByDisplayValue(''), {
      target: { value: 'deepseek-token' },
    });

    expect(onProviderPresetChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save environment variables' }));

    await waitFor(() => {
      expect(onEnvChange).toHaveBeenCalledWith(
        expect.objectContaining({
          ANTHROPIC_AUTH_TOKEN: 'deepseek-token',
          ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        }),
      );
    });
    expect(onProviderPresetChange).toHaveBeenCalledWith(
      expect.objectContaining({
        iconId: 'DeepSeek',
        id: 'deepseek',
      }),
    );
  });

  it('does not notify preset changes when environment edits are canceled', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const onProviderPresetChange = vi.fn();

    const provider = {
      billingType: 'api',
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          provider={provider}
          onProviderPresetChange={onProviderPresetChange}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit environment variables' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Provider preset' }), {
      target: { value: 'deepseek' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel environment changes' }));

    expect(onProviderPresetChange).not.toHaveBeenCalled();
  });

  it('only masks credential-like environment values', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);

    const provider = {
      billingType: 'api',
      command: 'claude',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'token-value',
        ANTHROPIC_BASE_URL: 'https://api.example.com',
        ANTHROPIC_MODEL: 'example-model',
      },
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit environment variables' }));

    expect(screen.getByDisplayValue('token-value')).toHaveAttribute('type', 'password');
    expect(screen.getByDisplayValue('https://api.example.com')).toHaveAttribute('type', 'text');
    expect(screen.getByDisplayValue('example-model')).toHaveAttribute('type', 'text');
  });

  it('blocks saving API billing env until required Anthropic variables are filled', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const onEnvChange = vi.fn();

    const provider = {
      billingType: 'api',
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} onEnvChange={onEnvChange} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit environment variables' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save environment variables' }));

    expect(
      screen.getByText(
        'Required for API billing: ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY',
      ),
    ).toBeInTheDocument();
    expect(onEnvChange).not.toHaveBeenCalled();
  });

  it('checks Claude Code API billing connectivity with edited environment values', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    checkClaudeCodeApiConnection.mockResolvedValue({
      message: 'Connection successful.',
      ok: true,
      responseTimeMs: 128,
      status: 200,
    });

    const provider = {
      billingType: 'api',
      command: 'claude',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'old-token',
        ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
      },
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit environment variables' }));
    fireEvent.change(screen.getByDisplayValue('old-token'), {
      target: { value: 'new-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => {
      expect(checkClaudeCodeApiConnection).toHaveBeenCalledWith({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'new-token',
          ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
        },
      });
    });
    expect(screen.getByText('Connection successful (128 ms)')).toBeInTheDocument();
  });

  it('does not check Claude Code API connectivity until required env values are present', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);

    const provider = {
      billingType: 'api',
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));

    expect(checkClaudeCodeApiConnection).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Connection failed: Required for API billing: ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY',
      ),
    ).toBeInTheDocument();
  });
});
