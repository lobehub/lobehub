/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isolateQuotaReplica } from '@/features/ChatInput/ControlBar/HeteroControlBar/QuotaMenu/testUtils';
import { agentQuotaService } from '@/services/agentQuota';
import { useAgentQuotaStore } from '@/store/agentQuota';
import {
  QUOTA_ACCOUNTS_KEY,
  type QuotaAccount,
  type QuotaBinding,
} from '@/store/agentQuota/projection';

import { nextAuthorizedAccountIds, useAgentAuthorizedAccounts } from './useAgentAuthorizedAccounts';

const account = (id: string, provider = 'claude-code') =>
  ({
    email: `${id}@example.com`,
    externalAccountId: `ext-${id}`,
    id,
    label: null,
    provider,
  }) as unknown as QuotaAccount;

const binding = (id: string, accountId: string, role: string, agentId = 'agent-1') =>
  ({ accountId, agentId, enabled: true, id, role }) as unknown as QuotaBinding;

const LB_CONFIG = {
  authorizedAccountIds: [],
  candidateAccountIds: [],
  mode: 'auto',
  pinScope: null,
  pinnedAccountId: null,
} as const;

describe('nextAuthorizedAccountIds', () => {
  const pool = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];

  it('adds or removes one account and keeps the rest of the set', () => {
    expect(nextAuthorizedAccountIds(pool, new Set(['a1']), 'a3', true)).toEqual(['a1', 'a3']);
    expect(nextAuthorizedAccountIds(pool, new Set(['a1', 'a3']), 'a1', false)).toEqual(['a3']);
  });

  it('drops authorized ids that are no longer in the pool', () => {
    expect(nextAuthorizedAccountIds(pool, new Set(['gone', 'a2']), 'a1', true)).toEqual([
      'a1',
      'a2',
    ]);
  });
});

describe('useAgentAuthorizedAccounts', () => {
  beforeEach(() => {
    isolateQuotaReplica();
    vi.spyOn(agentQuotaService, 'getLatestReadings').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the provider’s whole pool and marks only enabled pool/pinned bindings', async () => {
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([
      account('a1'),
      account('a2'),
      account('a3'),
      account('a4'),
      account('cx', 'codex'),
    ]);
    vi.spyOn(agentQuotaService, 'listBindings').mockResolvedValue([
      binding('b1', 'a1', 'pool'),
      binding('b2', 'a2', 'pinned'),
      binding('b3', 'a3', 'disabled'),
      { ...binding('b4', 'a4', 'pool'), enabled: false } as QuotaBinding,
    ]);

    const { result } = renderHook(() => useAgentAuthorizedAccounts('agent-1'));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.accounts.map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect([...result.current.authorized].sort()).toEqual(['a1', 'a2']);
    expect(result.current.canEdit).toBe(true);
  });

  it('writes the agent’s full set when one account is checked', async () => {
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([account('a1'), account('a2')]);
    vi.spyOn(agentQuotaService, 'listBindings').mockResolvedValue([binding('b1', 'a1', 'pool')]);
    const setAgentAccounts = vi
      .spyOn(agentQuotaService, 'setAgentAccounts')
      .mockResolvedValue(LB_CONFIG as never);

    const { result } = renderHook(() => useAgentAuthorizedAccounts('agent-1'));
    await waitFor(() => expect(result.current.canEdit).toBe(true));

    let ok = false;
    await act(async () => {
      ok = await result.current.toggle('a2', true);
    });

    expect(ok).toBe(true);
    expect(setAgentAccounts).toHaveBeenCalledWith('agent-1', ['a1', 'a2'], 'claude-code');
  });

  it('reports a refused write instead of throwing', async () => {
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([account('a1')]);
    vi.spyOn(agentQuotaService, 'listBindings').mockResolvedValue([]);
    vi.spyOn(agentQuotaService, 'setAgentAccounts').mockRejectedValue(new Error('NOT_FOUND'));

    const { result } = renderHook(() => useAgentAuthorizedAccounts('agent-1'));
    await waitFor(() => expect(result.current.canEdit).toBe(true));

    let ok = true;
    await act(async () => {
      ok = await result.current.toggle('a1', true);
    });
    expect(ok).toBe(false);
  });

  it('keeps another agent’s authorization of a shared account out of this agent’s set', async () => {
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([account('shared')]);
    vi.spyOn(agentQuotaService, 'listBindings').mockImplementation(async (agentId: string) =>
      agentId === 'agent-2' ? [binding('b9', 'shared', 'pool', 'agent-2')] : [],
    );

    const one = renderHook(() => useAgentAuthorizedAccounts('agent-1'));
    const two = renderHook(() => useAgentAuthorizedAccounts('agent-2'));

    await waitFor(() => expect(two.result.current.authorized.has('shared')).toBe(true));
    await waitFor(() => expect(one.result.current.loaded).toBe(true));
    expect(one.result.current.authorized.has('shared')).toBe(false);
  });

  it('reports a failed bindings load as unknown, not as an empty set, and retries it', async () => {
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([account('a1')]);
    const listBindings = vi
      .spyOn(agentQuotaService, 'listBindings')
      .mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useAgentAuthorizedAccounts('agent-1'));

    await waitFor(() => expect(result.current.loadFailed).toBe(true), { timeout: 15_000 });
    expect(result.current.loaded).toBe(false);
    expect(result.current.canEdit).toBe(false);

    listBindings.mockResolvedValue([binding('b1', 'a1', 'pool')]);
    await act(async () => {
      await result.current.retry();
    });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.authorized.has('a1')).toBe(true);
  }, 20_000);

  it('reports a failed account list as a load failure, not as an empty pool', async () => {
    vi.spyOn(agentQuotaService, 'listAccounts').mockRejectedValue(new Error('network down'));
    vi.spyOn(agentQuotaService, 'listBindings').mockResolvedValue([binding('b1', 'a1', 'pool')]);

    const { result } = renderHook(() => useAgentAuthorizedAccounts('agent-1'));

    await waitFor(() => expect(result.current.loadFailed).toBe(true), { timeout: 15_000 });
    expect(result.current.loaded).toBe(false);
    expect(result.current.accounts).toHaveLength(0);
  }, 20_000);

  // Regression: with the lists restored from storage, a failed refresh left the
  // checkboxes disabled for good and offered no error or Retry.
  it('reports a failed refresh behind hydrated data instead of disabling the list silently', async () => {
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([account('a1')]);
    vi.spyOn(agentQuotaService, 'listBindings').mockRejectedValue(new Error('network down'));
    act(() =>
      useAgentQuotaStore.setState({
        quotaAccountsMap: { [QUOTA_ACCOUNTS_KEY]: [account('a1')] },
        quotaBindingsMap: { 'agent-1': [binding('b1', 'a1', 'pool')] },
      }),
    );

    const { result } = renderHook(() => useAgentAuthorizedAccounts('agent-1'));

    expect(result.current.authorized.has('a1')).toBe(true);
    await waitFor(() => expect(result.current.loadFailed).toBe(true), { timeout: 15_000 });
    expect(result.current.canEdit).toBe(false);
  }, 20_000);

  it('takes no writes before the server confirms the bindings', async () => {
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([account('a1')]);
    vi.spyOn(agentQuotaService, 'listBindings').mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useAgentAuthorizedAccounts('agent-1'));

    await waitFor(() => expect(result.current.accounts).toHaveLength(1));
    expect(result.current.loaded).toBe(false);
    expect(result.current.canEdit).toBe(false);
  });
});
