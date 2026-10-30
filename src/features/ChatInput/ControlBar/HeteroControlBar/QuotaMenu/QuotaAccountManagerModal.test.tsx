/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentQuotaService } from '@/services/agentQuota';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { useAgentQuotaStore } from '@/store/agentQuota';
import {
  QUOTA_ACCOUNTS_KEY,
  type QuotaAccount,
  type QuotaBinding,
} from '@/store/agentQuota/projection';
import { useElectronStore } from '@/store/electron';

import QuotaAccountManager from './QuotaAccountManagerModal';
import { isolateQuotaReplica } from './testUtils';

const desktop = vi.hoisted(() => ({ value: false }));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    get isDesktop() {
      return desktop.value;
    },
  };
});

const account = (id: string) =>
  ({
    email: `${id}@example.com`,
    externalAccountId: `ext-${id}`,
    id,
    label: null,
    provider: 'claude-code',
  }) as unknown as QuotaAccount;

/** The label of the option the radio group shows as selected. */
const checkedOption = () =>
  screen.getByRole('radio', { checked: true }).closest('label')?.textContent;

const binding = (id: string, accountId: string, role: string) =>
  ({ accountId, agentId: 'agent-1', id, role }) as unknown as QuotaBinding;

describe('QuotaAccountManager', () => {
  beforeEach(() => {
    isolateQuotaReplica();
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([account('a1')]);
    vi.spyOn(agentQuotaService, 'getLatestReadings').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows no "no account" hint and keeps the controls disabled until the bindings load', async () => {
    let answerBindings!: (rows: QuotaBinding[]) => void;
    vi.spyOn(agentQuotaService, 'listBindings').mockImplementation(
      () => new Promise((resolve) => (answerBindings = resolve)),
    );
    // The account pool painted from the replica; this agent's bindings did not.
    act(() =>
      useAgentQuotaStore.setState({ quotaAccountsMap: { [QUOTA_ACCOUNTS_KEY]: [account('a1')] } }),
    );

    render(<QuotaAccountManager agentId={'agent-1'} />);

    expect(screen.getByText('a1@example.com')).toBeTruthy();
    expect(screen.queryByText('heteroAgent.claudeQuota.manage.autoNoAccount')).toBeNull();
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('radio', { checked: true })).toBeNull();

    await act(async () => answerBindings([binding('b1', 'a1', 'pool')]));

    expect(screen.queryByText('heteroAgent.claudeQuota.manage.autoNoAccount')).toBeNull();
    expect(screen.getByText(/heteroAgent\.claudeQuota\.manage\.autoRoutingTo/)).toBeTruthy();
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(false);
    // Auto is the confirmed mode now, and the group shows it.
    expect(checkedOption()).toContain('heteroAgent.claudeQuota.manage.modeAuto');
  });

  it('treats another coding agent’s pin as Auto for Claude and leaves it alone', async () => {
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([
      account('a1'),
      { ...account('kimi'), provider: 'kimi-code' } as QuotaAccount,
    ]);
    vi.spyOn(agentQuotaService, 'listBindings').mockResolvedValue([
      binding('b1', 'a1', 'pool'),
      binding('b2', 'kimi', 'pinned'),
    ]);

    render(<QuotaAccountManager agentId={'agent-1'} />);

    // Claude routing skips the Kimi pin, so for Claude this agent is on Auto.
    await vi.waitFor(() =>
      expect(checkedOption()).toContain('heteroAgent.claudeQuota.manage.modeAuto'),
    );
    expect(screen.getByText(/heteroAgent\.claudeQuota\.manage\.autoRoutingTo/)).toBeTruthy();
  });

  it('selects the pinned account once the bindings load', async () => {
    let answerBindings!: (rows: QuotaBinding[]) => void;
    vi.spyOn(agentQuotaService, 'listBindings').mockImplementation(
      () => new Promise((resolve) => (answerBindings = resolve)),
    );
    act(() =>
      useAgentQuotaStore.setState({ quotaAccountsMap: { [QUOTA_ACCOUNTS_KEY]: [account('a1')] } }),
    );

    render(<QuotaAccountManager agentId={'agent-1'} />);
    await act(async () => answerBindings([binding('b1', 'a1', 'pinned')]));

    expect(checkedOption()).toContain('a1@example.com');
  });

  it('shows hydrated bindings but takes writes only after the server confirms them', async () => {
    let answerBindings!: (rows: QuotaBinding[]) => void;
    vi.spyOn(agentQuotaService, 'listBindings').mockImplementation(
      () => new Promise((resolve) => (answerBindings = resolve)),
    );
    // Restored from storage: a1 pinned, but another device has since moved it to the pool.
    act(() =>
      useAgentQuotaStore.setState({
        quotaAccountsMap: { [QUOTA_ACCOUNTS_KEY]: [account('a1')] },
        quotaBindingsMap: { 'agent-1': [binding('b1', 'a1', 'pinned')] },
      }),
    );

    render(<QuotaAccountManager agentId={'agent-1'} />);

    expect(checkedOption()).toContain('a1@example.com');
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true);
    for (const radio of screen.getAllByRole('radio'))
      expect(radio.getAttribute('aria-disabled')).toBe('true');

    await act(async () => answerBindings([binding('b1', 'a1', 'pool')]));

    expect(checkedOption()).toContain('heteroAgent.claudeQuota.manage.modeAuto');
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(false);
    expect(
      screen
        .getByRole('radio', { name: /heteroAgent\.claudeQuota\.manage\.modeAuto/ })
        .getAttribute('aria-disabled'),
    ).not.toBe('true');
  });

  it('offers Remove for a hydrated binding only after the server confirms it', async () => {
    let answerBindings!: (rows: QuotaBinding[]) => void;
    vi.spyOn(agentQuotaService, 'listBindings').mockImplementation(
      () => new Promise((resolve) => (answerBindings = resolve)),
    );
    act(() =>
      useAgentQuotaStore.setState({
        quotaAccountsMap: { [QUOTA_ACCOUNTS_KEY]: [account('a1')] },
        quotaBindingsMap: { 'agent-1': [binding('stale', 'a1', 'pool')] },
      }),
    );
    const removeItem = () =>
      screen.findByRole('menuitem', { name: /heteroAgent\.claudeQuota\.manage\.remove/ });

    render(<QuotaAccountManager agentId={'agent-1'} />);
    fireEvent.click(screen.getByRole('button', { name: 'heteroAgent.claudeQuota.manage.more' }));

    expect((await removeItem()).getAttribute('aria-disabled')).toBe('true');

    await act(async () => answerBindings([binding('b1', 'a1', 'pool')]));

    expect((await removeItem()).getAttribute('aria-disabled')).not.toBe('true');
  });
});

const localLogin = (externalAccountId: string, configDir: string | null) => ({
  configDir,
  identity: { email: `${externalAccountId}@example.com`, externalAccountId },
});

const radioFor = (email: string) =>
  screen
    .getAllByRole('radio')
    .find((radio) => radio.closest('label')?.textContent?.includes(email))!;

/** The local-login list is device data in the SWR cache: give each case its own. */
const renderWithFreshCache = (ui: ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>);

describe('QuotaAccountManager on the desktop', () => {
  beforeEach(() => {
    desktop.value = true;
    isolateQuotaReplica();
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([
      account('here'),
      account('away'),
    ]);
    vi.spyOn(agentQuotaService, 'getLatestReadings').mockResolvedValue([]);
    vi.spyOn(agentQuotaService, 'listBindings').mockResolvedValue([
      binding('b1', 'here', 'pool'),
      binding('b2', 'away', 'pool'),
    ]);
    vi.spyOn(heterogeneousAgentService, 'listClaudeCodeAccounts').mockResolvedValue([
      localLogin('ext-here', null),
    ] as never);
    vi.spyOn(heterogeneousAgentService, 'getClaudeCodeQuota').mockResolvedValue({
      status: 'unavailable',
    } as never);
    vi.spyOn(agentQuotaService, 'getDeviceAccount').mockResolvedValue({ accountId: null });
    vi.spyOn(agentQuotaService, 'syncDeviceLogins').mockResolvedValue(undefined as never);
    vi.spyOn(useElectronStore.getState(), 'resolveGatewayDeviceId').mockImplementation(
      async () => useElectronStore.getState().gatewayDeviceInfo?.deviceId,
    );
  });

  afterEach(() => {
    desktop.value = false;
    useElectronStore.setState({ gatewayDeviceInfo: undefined });
    vi.restoreAllMocks();
  });

  it('marks an account with no login on this device and keeps it from being picked', async () => {
    renderWithFreshCache(<QuotaAccountManager agentId={'agent-1'} />);

    await screen.findByText('heteroAgent.claudeQuota.manage.notSignedIn');
    expect(radioFor('away@example.com').getAttribute('aria-disabled')).toBe('true');
    expect(radioFor('here@example.com').getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.getAllByText('heteroAgent.claudeQuota.manage.notSignedIn')).toHaveLength(1);
  });

  it('does not judge a remote device’s accounts by this desktop’s logins', async () => {
    act(() =>
      useElectronStore.setState({ gatewayDeviceInfo: { deviceId: 'this-desktop' } } as never),
    );
    renderWithFreshCache(<QuotaAccountManager agentId={'agent-1'} deviceId={'device-1'} />);

    // The device holds its own logins: `away` may well be signed in there.
    await screen.findByText('away@example.com');
    await waitFor(() =>
      expect(radioFor('away@example.com').getAttribute('aria-disabled')).not.toBe('true'),
    );
    expect(heterogeneousAgentService.listClaudeCodeAccounts).not.toHaveBeenCalled();
    expect(screen.queryByText('heteroAgent.claudeQuota.manage.notSignedIn')).toBeNull();
    expect(screen.queryByText('heteroAgent.claudeQuota.manage.signIn')).toBeNull();
    // Signing in here would not reach the device, so no local sign-in entry either.
    expect(
      screen.queryByRole('button', { name: /heteroAgent\.claudeQuota\.manage\.add/ }),
    ).toBeNull();
  });

  it('keeps local login checks when bound to this desktop’s own device', async () => {
    act(() =>
      useElectronStore.setState({ gatewayDeviceInfo: { deviceId: 'this-desktop' } } as never),
    );
    renderWithFreshCache(<QuotaAccountManager agentId={'agent-1'} deviceId={'this-desktop'} />);

    // A gateway run on this device spawns on this desktop's logins.
    await screen.findByText('heteroAgent.claudeQuota.manage.notSignedIn');
    expect(radioFor('away@example.com').getAttribute('aria-disabled')).toBe('true');
    expect(heterogeneousAgentService.listClaudeCodeAccounts).toHaveBeenCalled();
  });

  it('shows this device’s own pick over the agent-wide pin', async () => {
    act(() =>
      useElectronStore.setState({ gatewayDeviceInfo: { deviceId: 'this-desktop' } } as never),
    );
    vi.mocked(agentQuotaService.listBindings).mockResolvedValue([
      binding('b1', 'here', 'pinned'),
      binding('b2', 'away', 'pool'),
    ]);
    vi.mocked(agentQuotaService.getDeviceAccount).mockResolvedValue({ accountId: 'away' });

    renderWithFreshCache(<QuotaAccountManager agentId={'agent-1'} deviceId={'device-1'} />);

    await waitFor(() => expect(checkedOption()).toContain('away@example.com'));
    expect(agentQuotaService.getDeviceAccount).toHaveBeenCalledWith('agent-1', 'device-1');
  });

  // Regression: a pin made on another machine read as this device's choice,
  // with its account marked "not signed in on this device".
  it('reads an agent-wide pin this device cannot run as Auto', async () => {
    act(() =>
      useElectronStore.setState({ gatewayDeviceInfo: { deviceId: 'this-desktop' } } as never),
    );
    vi.mocked(agentQuotaService.listBindings).mockResolvedValue([
      binding('b1', 'here', 'pool'),
      binding('b2', 'away', 'pinned'),
    ]);

    renderWithFreshCache(<QuotaAccountManager agentId={'agent-1'} />);

    await screen.findByText('heteroAgent.claudeQuota.manage.notSignedIn');
    await waitFor(() =>
      expect(checkedOption()).toContain('heteroAgent.claudeQuota.manage.modeAuto'),
    );
    expect(screen.getByText(/heteroAgent\.claudeQuota\.manage\.autoRoutingTo/)).toBeTruthy();
  });

  it('saves a switch for this device only, not for every device', async () => {
    act(() =>
      useElectronStore.setState({ gatewayDeviceInfo: { deviceId: 'this-desktop' } } as never),
    );
    const setDeviceAccount = vi
      .spyOn(agentQuotaService, 'setDeviceAccount')
      .mockResolvedValue(undefined as never);
    const switchAccount = vi.spyOn(agentQuotaService, 'switchAccount');

    renderWithFreshCache(<QuotaAccountManager agentId={'agent-1'} />);
    await waitFor(() =>
      expect(radioFor('here@example.com').getAttribute('aria-disabled')).not.toBe('true'),
    );
    fireEvent.click(radioFor('here@example.com'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'heteroAgent.claudeQuota.manage.confirmSwitch' }),
    );

    await waitFor(() =>
      expect(setDeviceAccount).toHaveBeenCalledWith('agent-1', 'this-desktop', 'here'),
    );
    expect(switchAccount).not.toHaveBeenCalled();
  });

  it('lists only Claude Code accounts, never another coding agent’s', async () => {
    vi.mocked(agentQuotaService.listAccounts).mockResolvedValue([
      account('here'),
      { ...account('kimi'), provider: 'kimi-code' } as QuotaAccount,
    ]);

    renderWithFreshCache(<QuotaAccountManager agentId={'agent-1'} />);

    await screen.findByText('here@example.com');
    expect(screen.queryByText('kimi@example.com')).toBeNull();
  });

  it('registers the default login even when its usage call fails', async () => {
    vi.mocked(heterogeneousAgentService.listClaudeCodeAccounts).mockResolvedValue([
      localLogin('ext-default', null),
    ] as never);
    vi.mocked(heterogeneousAgentService.getClaudeCodeQuota).mockRejectedValue(
      new Error('403 request blocked'),
    );
    const ingest = vi
      .spyOn(agentQuotaService, 'ingestClaudeSnapshot')
      .mockResolvedValue({} as never);

    renderWithFreshCache(<QuotaAccountManager agentId={'agent-1'} />);

    await waitFor(() =>
      expect(ingest).toHaveBeenCalledWith({
        identity: expect.objectContaining({ externalAccountId: 'ext-default' }),
        readings: [],
      }),
    );
  });

  it('never previews Auto routing to an account this device cannot run', async () => {
    // Only `away` (no login here) is in rotation: runtime has nothing to route to.
    vi.mocked(agentQuotaService.listBindings).mockResolvedValue([
      binding('b1', 'here', 'disabled'),
      binding('b2', 'away', 'pool'),
    ]);

    renderWithFreshCache(<QuotaAccountManager agentId={'agent-1'} />);

    await screen.findByText('heteroAgent.claudeQuota.manage.notSignedIn');
    expect(screen.getByText('heteroAgent.claudeQuota.manage.autoNoAccount')).toBeTruthy();
    expect(screen.queryByText(/heteroAgent\.claudeQuota\.manage\.autoRoutingTo/)).toBeNull();
  });

  it('signs the account in on this device from its row', async () => {
    const login = vi
      .spyOn(heterogeneousAgentService, 'loginClaudeCodeAccount')
      .mockResolvedValue(localLogin('ext-away', '/profiles/away') as never);

    renderWithFreshCache(<QuotaAccountManager agentId={'agent-1'} />);
    fireEvent.click(await screen.findByText('heteroAgent.claudeQuota.manage.signIn'));

    await waitFor(() => expect(login).toHaveBeenCalledWith({ email: 'away@example.com' }));
  });

  it('adds a new account through the browser and puts it in rotation', async () => {
    let finishLogin!: (value: unknown) => void;
    vi.spyOn(heterogeneousAgentService, 'loginClaudeCodeAccount').mockImplementation(
      () => new Promise((resolve) => (finishLogin = resolve)) as never,
    );
    const bindAccount = vi
      .spyOn(agentQuotaService, 'bindAccount')
      .mockResolvedValue(binding('b3', 'new', 'pool') as never);
    vi.spyOn(agentQuotaService, 'ingestClaudeSnapshot').mockResolvedValue({} as never);

    renderWithFreshCache(<QuotaAccountManager agentId={'agent-1'} />);
    fireEvent.click(
      await screen.findByRole('button', { name: /heteroAgent\.claudeQuota\.manage\.add/ }),
    );

    // Waiting on the browser: the footer says so and offers Cancel.
    await screen.findByText('heteroAgent.claudeQuota.manage.loginWaiting');

    vi.mocked(agentQuotaService.listAccounts).mockResolvedValue([
      account('here'),
      account('away'),
      account('new'),
    ]);
    await act(async () => finishLogin(localLogin('ext-new', '/profiles/new')));

    await waitFor(() => expect(bindAccount).toHaveBeenCalledWith('agent-1', 'new', 'pool'));
    expect(screen.queryByText('heteroAgent.claudeQuota.manage.loginWaiting')).toBeNull();
  });
});
