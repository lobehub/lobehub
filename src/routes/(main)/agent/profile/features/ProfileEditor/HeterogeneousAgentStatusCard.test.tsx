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
      : type === 'droid'
        ? {
            defaultCommand: 'droid',
            icon: () => <span>Factory Droid Icon</span>,
            title: 'Factory Droid',
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

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
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
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
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
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
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
  Select: ({
    onChange,
    options,
    value,
  }: {
    onChange?: (value: string) => void;
    options?: Array<{
      disabled?: boolean;
      label?: ReactNode;
      options?: Array<{ disabled?: boolean; label: ReactNode; value: string }>;
      value?: string;
    }>;
    value?: string;
  }) => (
    <select value={value} onChange={(event) => onChange?.(event.target.value)}>
      {options?.flatMap((option) =>
        option.options
          ? option.options.map((child) => (
              <option disabled={child.disabled} key={child.value} value={child.value}>
                {child.label}
              </option>
            ))
          : option.value
            ? [
                <option disabled={option.disabled} key={option.value} value={option.value}>
                  {option.label}
                </option>,
              ]
            : [],
      )}
    </select>
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      (
        ({
          'heterogeneousStatus.account.label': 'Account',
          'heterogeneousStatus.apiMode.enableInLabs': 'Enable in Labs',
          'heterogeneousStatus.apiMode.labDisabled':
            'Other provider bindings are a Labs experiment. Enable it to use a configured provider instead of LobeHub.',
          'heterogeneousStatus.apiMode.defaultProvider': 'LobeHub',
          'heterogeneousStatus.apiMode.provider': 'Provider',
          'heterogeneousStatus.apiMode.providerPlaceholder': 'Select a provider',
          'heterogeneousStatus.auth.api': 'API',
          'heterogeneousStatus.auth.label': 'Auth Method',
          'heterogeneousStatus.auth.subscription': 'Subscription',
          'heterogeneousStatus.command.edit': 'Edit command',
          'heterogeneousStatus.command.label': 'Command',
          'heterogeneousStatus.command.placeholder': 'Command name or absolute path',
          'heterogeneousStatus.detecting': `Detecting ${options?.name ?? ''} CLI`,
          'heterogeneousStatus.plan.label': 'Plan',
          'heterogeneousStatus.redetect': 'Re-detect',
          'heterogeneousStatus.apiMode.serverDefault.retry': 'Retry',
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

vi.mock('@/components/ModelSelect', () => ({
  ModelItemRender: ({ displayName, id }: { displayName?: string; id: string }) => (
    <span>{displayName || id}</span>
  ),
  ProviderItemRender: ({ name }: { name: string }) => <span>{name}</span>,
  TAG_CLASSNAME: 'lobe-model-info-tags',
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (state: { builtinAiModelList: never[] }) => unknown) =>
    selector({ builtinAiModelList: [] }),
}));

vi.mock('@/services/electron/binary', () => ({
  binaryService: {
    detectHeterogeneousAgentCommand,
    getClaudeAuthStatus,
  },
}));

const claudeServerModels = [{ model: 'claude-sonnet-4-6' }, { model: 'claude-haiku-4-5' }];

const codexServerModels = [{ model: 'gpt-5.4' }];

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

  it('detects Factory Droid and shows its install guide when unavailable', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: false });

    const provider = {
      command: 'droid',
      type: 'droid',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard provider={provider} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
        agentType: 'droid',
        command: 'droid',
      });
    });

    expect(screen.getByText('Factory Droid CLI')).toBeInTheDocument();
    expect(screen.getByText('Factory Droid CLI is unavailable')).toBeInTheDocument();
    expect(screen.getByText('droid Install Guide')).toBeInTheDocument();
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
        <HeterogeneousAgentStatusCard apiModeLabEnabled provider={provider} />
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
    expect(screen.getByRole('button', { name: 'API' })).toBeDisabled();
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

  it('offers the deployment default when switching to API mode with Labs enabled', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const onAuthModeChange = vi.fn();
    const provider = {
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    const { rerender } = render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          apiModeAvailable
          apiModeLabEnabled
          serverDefaultAvailable
          provider={provider}
          serverDefaultModels={claudeServerModels}
          onAuthModeChange={onAuthModeChange}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('claude')).toBeInTheDocument();
    });
    expect(screen.getByText('Auth Method')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'LobeHub Server' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'API' }));
    expect(onAuthModeChange).toHaveBeenCalledWith('api', {
      model: 'claude-sonnet-4-6',
      source: 'server-default',
    });

    const apiProvider = {
      ...provider,
      apiConfig: { model: 'claude-sonnet-4-6', source: 'server-default' as const },
      authMode: 'api' as const,
    } satisfies HeterogeneousProviderConfig;

    rerender(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          apiModeAvailable
          apiModeLabEnabled
          serverDefaultAvailable
          provider={apiProvider}
          serverDefaultModels={claudeServerModels}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Auth Method')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'LobeHub' })).toBeEnabled();
  });

  it('gates the deployment default behind Labs like the rest of API mode', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const provider = {
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    // Labs off: even with stale server-default props from the parent, the API
    // experiment stays hidden for subscription agents.
    const { rerender } = render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          apiModeAvailable
          serverDefaultAvailable
          provider={provider}
          serverDefaultModels={claudeServerModels}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('claude')).toBeInTheDocument();
    });
    expect(screen.queryByText('Auth Method')).not.toBeInTheDocument();

    // A leftover server-default agent stays visible so it can switch back,
    // but only sees the Labs pointer — no provider or model pickers.
    const leftoverProvider = {
      ...provider,
      apiConfig: { model: 'claude-sonnet-4-6', source: 'server-default' as const },
      authMode: 'api' as const,
    } satisfies HeterogeneousProviderConfig;

    rerender(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          apiModeAvailable
          serverDefaultAvailable
          provider={leftoverProvider}
          serverDefaultModels={claudeServerModels}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Auth Method')).toBeInTheDocument();
    expect(screen.getByText('Enable in Labs')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'LobeHub' })).not.toBeInTheDocument();
  });

  it('lists the deployment default alongside configured providers in API mode', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    getClaudeAuthStatus.mockResolvedValue(null);
    const onApiConfigChange = vi.fn();
    const provider = {
      apiConfig: { model: 'claude-sonnet-4-6', source: 'server-default' },
      authMode: 'api',
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          apiModeAvailable
          apiModeLabEnabled
          serverDefaultAvailable
          provider={provider}
          serverDefaultModels={claudeServerModels}
          onApiConfigChange={onApiConfigChange}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('option', { name: 'LobeHub' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Anthropic' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('option', { name: 'LobeHub' }).closest('select')!, {
      target: { value: 'provider:anthropic' },
    });
    expect(onApiConfigChange).toHaveBeenCalledWith({
      model: 'claude-primary',
      providerId: 'anthropic',
      source: 'provider',
    });
  });

  it('explains an unavailable server capability and offers retry', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    const onServerDefaultRetry = vi.fn();
    const provider = {
      command: 'codex',
      type: 'codex',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          apiModeLabEnabled
          provider={provider}
          serverDefaultUnavailableReason="Deployment default model is unavailable"
          onServerDefaultRetry={onServerDefaultRetry}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Deployment default model is unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    expect(onServerDefaultRetry).toHaveBeenCalledOnce();
  });

  it('selects a deployment-provided model from the default API provider', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    const onApiConfigChange = vi.fn();
    const provider = {
      apiConfig: { model: 'claude-sonnet-4-6', source: 'server-default' },
      authMode: 'api',
      command: 'claude',
      type: 'claude-code',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          apiModeLabEnabled
          serverDefaultAvailable
          provider={provider}
          serverDefaultModels={claudeServerModels}
          onApiConfigChange={onApiConfigChange}
        />
      </MemoryRouter>,
    );

    const modelOption = await screen.findByRole('option', { name: 'claude-sonnet-4-6' });
    expect(screen.queryByText('gpt-5.4')).not.toBeInTheDocument();
    fireEvent.change(modelOption.closest('select')!, { target: { value: 'claude-haiku-4-5' } });
    expect(onApiConfigChange).toHaveBeenCalledWith({
      model: 'claude-haiku-4-5',
      source: 'server-default',
    });
  });

  it('falls back when the saved server model is not in the agent capability', async () => {
    detectHeterogeneousAgentCommand.mockResolvedValue({ available: true });
    const onApiConfigChange = vi.fn();
    const provider = {
      apiConfig: { model: 'claude-server', source: 'server-default' },
      authMode: 'api',
      command: 'codex',
      type: 'codex',
    } satisfies HeterogeneousProviderConfig;

    render(
      <MemoryRouter>
        <HeterogeneousAgentStatusCard
          apiModeLabEnabled
          serverDefaultAvailable
          provider={provider}
          serverDefaultModels={codexServerModels}
          onApiConfigChange={onApiConfigChange}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('option', { name: 'gpt-5.4' })).toBeInTheDocument();
    expect(screen.queryByText('claude-server')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(onApiConfigChange).toHaveBeenCalledWith({
        model: 'gpt-5.4',
        source: 'server-default',
      });
    });
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
    expect(screen.getByRole('button', { name: 'API' })).toBeEnabled();
    expect(screen.getByText('Enable in Labs')).toBeInTheDocument();
    // The pickers stay hidden while Labs is off; only the pointer remains.
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
