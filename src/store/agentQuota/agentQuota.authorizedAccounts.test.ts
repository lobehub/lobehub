/**
 * @vitest-environment happy-dom
 *
 * The accounts an agent may schedule: the Agent Profile writes the whole set
 * at once, and the load balancer only ever picks from it.
 */
import { randomUUID } from 'node:crypto';

import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { agentQuotaService } from '@/services/agentQuota';

import { agentQuotaSelectors, useAgentQuotaStore } from './index';
import { initialState } from './initialState';
import { QUOTA_ACCOUNTS_KEY } from './projection';

const account = (id: string, provider = 'claude-code') => ({ id, provider }) as never;
const binding = (accountId: string, role: string, enabled = true) =>
  ({ accountId, agentId: 'agent-1', enabled, id: `b-${accountId}`, role }) as never;

const config = {
  authorizedAccountIds: ['acc-1', 'acc-3'],
  candidateAccountIds: ['acc-1', 'acc-3'],
  mode: 'auto' as const,
  pinScope: null,
  pinnedAccountId: null,
};

beforeEach(() => {
  const scope = `quota-authz-${randomUUID()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  act(() =>
    useAgentQuotaStore.setState(
      {
        ...initialState,
        quotaAccountsMap: {
          [QUOTA_ACCOUNTS_KEY]: [
            account('acc-1'),
            account('acc-2'),
            account('acc-3'),
            account('codex-1', 'codex'),
          ],
        },
      },
      false,
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('authorized accounts', () => {
  it('derives the authorized set from enabled pool / pinned bindings, per provider', async () => {
    vi.spyOn(agentQuotaService, 'listBindings').mockResolvedValue([
      binding('acc-1', 'pinned'),
      binding('acc-2', 'disabled'),
      binding('acc-3', 'pool', false),
      binding('codex-1', 'pool'),
    ]);
    await useAgentQuotaStore.getState().readQuotaBindings('agent-1');

    const state = useAgentQuotaStore.getState();
    expect(agentQuotaSelectors.authorizedAccountIds('agent-1', 'claude-code')(state)).toEqual([
      'acc-1',
    ]);
    expect(agentQuotaSelectors.authorizedAccountIds('agent-1')(state)).toEqual([
      'acc-1',
      'codex-1',
    ]);
    expect(agentQuotaSelectors.authorizedAccountIds('agent-2')(state)).toBeUndefined();
  });

  it('writes the whole set, drops the rest of the provider at once, and re-reads the bindings', async () => {
    const listBindings = vi
      .spyOn(agentQuotaService, 'listBindings')
      .mockResolvedValueOnce([
        binding('acc-1', 'pool'),
        binding('acc-2', 'pool'),
        binding('codex-1', 'pool'),
      ])
      .mockResolvedValue([
        binding('acc-1', 'pool'),
        binding('acc-3', 'pool'),
        binding('codex-1', 'pool'),
      ]);
    let release!: () => void;
    const setAgentAccounts = vi.spyOn(agentQuotaService, 'setAgentAccounts').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(config);
        }),
    );

    let done!: Promise<unknown>;
    await act(async () => {
      done = useAgentQuotaStore
        .getState()
        .setQuotaAgentAccounts('agent-1', ['acc-1', 'acc-3'], 'claude-code');
      await vi.waitFor(() => expect(setAgentAccounts).toHaveBeenCalled());
    });

    // optimistic: acc-2 leaves at once; the other provider's binding stays
    expect(
      agentQuotaSelectors.authorizedAccountIds('agent-1')(useAgentQuotaStore.getState()),
    ).toEqual(['acc-1', 'codex-1']);

    await act(async () => {
      release();
      await expect(done).resolves.toEqual(config);
    });

    expect(setAgentAccounts).toHaveBeenCalledWith('agent-1', ['acc-1', 'acc-3'], 'claude-code');
    expect(listBindings).toHaveBeenCalledTimes(2);
    expect(
      agentQuotaSelectors.authorizedAccountIds(
        'agent-1',
        'claude-code',
      )(useAgentQuotaStore.getState()),
    ).toEqual(['acc-1', 'acc-3']);
  });

  it('reads the load-balancing config from the server', async () => {
    const get = vi.spyOn(agentQuotaService, 'getLoadBalanceConfig').mockResolvedValue(config);
    await expect(
      useAgentQuotaStore
        .getState()
        .readQuotaLoadBalanceConfig('agent-1', { deviceId: 'device-a', provider: 'claude-code' }),
    ).resolves.toEqual(config);
    expect(get).toHaveBeenCalledWith('agent-1', { deviceId: 'device-a', provider: 'claude-code' });
  });

  it("re-reads the agent's device picks, which the server drops for unauthorized accounts", async () => {
    vi.spyOn(agentQuotaService, 'listBindings').mockResolvedValue([binding('acc-1', 'pool')]);
    vi.spyOn(agentQuotaService, 'setAgentAccounts').mockResolvedValue(config);
    const getDeviceAccount = vi
      .spyOn(agentQuotaService, 'getDeviceAccount')
      .mockResolvedValueOnce({ accountId: 'acc-2' })
      .mockResolvedValue({ accountId: null });

    await useAgentQuotaStore.getState().readQuotaDeviceAccount('agent-1', 'device-a');
    await act(() =>
      useAgentQuotaStore.getState().setQuotaAgentAccounts('agent-1', ['acc-1'], 'claude-code'),
    );

    expect(getDeviceAccount).toHaveBeenCalledTimes(2);
    expect(
      agentQuotaSelectors.deviceAccount('agent-1', 'device-a')(useAgentQuotaStore.getState()),
    ).toEqual({ accountId: null });
  });
});
