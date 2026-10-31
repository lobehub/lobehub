/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { useAgentQuotaStore } from '@/store/agentQuota';
import { initialState } from '@/store/agentQuota/initialState';

import { useQuotaCalendarHistory } from './useQuotaCalendarHistory';

const mockQuotaService = vi.hoisted(() => ({
  getWindows: vi.fn(),
  listAccounts: vi.fn(),
  listSnapshots: vi.fn(),
  listUsageTurns: vi.fn(),
}));

vi.mock('@/services/agentQuota', () => ({ agentQuotaService: mockQuotaService }));

const claudeAccount = {
  externalAccountId: 'ext-1',
  id: 'acc-1',
  provider: 'claude-code',
  updatedAt: new Date(),
};

const reading = {
  capturedAt: Date.now() - 60_000,
  limitType: 'session',
  resetsAt: Date.now() + 2 * 3_600_000,
  scopeKey: '',
  utilization: 40,
};

const pending = () => new Promise<never>(() => {});

/** Each mount gets its own request cache, like a reopened app. */
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const open = () => renderHook(() => useQuotaCalendarHistory('claude-code'), { wrapper });

/** A reload: memory is gone, storage keeps what the last session persisted. */
const reload = () => act(() => useAgentQuotaStore.setState(initialState, false));

describe('useQuotaCalendarHistory', () => {
  let scope = '';

  beforeEach(() => {
    scope = `quota-calendar-${Math.random().toString(36).slice(2)}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    reload();
    mockQuotaService.listAccounts.mockReset().mockResolvedValue([claudeAccount]);
    mockQuotaService.getWindows.mockReset().mockResolvedValue([]);
    mockQuotaService.listSnapshots.mockReset().mockResolvedValue([reading]);
    mockQuotaService.listUsageTurns.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reopens on the last history after a reload before the network answers', async () => {
    const first = open();
    await waitFor(() => expect(first.result.current.readings).toHaveLength(1));
    first.unmount();

    reload();
    mockQuotaService.listAccounts.mockImplementation(pending);
    mockQuotaService.getWindows.mockImplementation(pending);
    mockQuotaService.listSnapshots.mockImplementation(pending);
    mockQuotaService.listUsageTurns.mockImplementation(pending);
    const { result } = open();

    await waitFor(() => expect(result.current.readings).toHaveLength(1));
    expect(result.current.loading).toBe(false);
  });

  it('keeps loading over an empty local history until the server confirms it', async () => {
    mockQuotaService.listSnapshots.mockResolvedValue([]);
    const first = open();
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    reload();
    let release!: (value: unknown[]) => void;
    mockQuotaService.getWindows.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    const { result } = open();

    await waitFor(() =>
      expect(useAgentQuotaStore.getState().quotaHistoryMap['acc-1']).toBeDefined(),
    );
    expect(result.current.loading).toBe(true);

    await act(async () => release([]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.readings).toEqual([]);
  });

  it('does not call the account unavailable while only an outdated local list says so', async () => {
    mockQuotaService.listAccounts.mockResolvedValue([]);
    const first = open();
    await waitFor(() => expect(first.result.current.accountUnavailable).toBe(true));
    first.unmount();

    reload();
    let release!: (value: unknown[]) => void;
    mockQuotaService.listAccounts.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    const { result } = open();

    await waitFor(() => expect(useAgentQuotaStore.getState().quotaAccountsMap.all).toEqual([]));
    expect(result.current.accountUnavailable).toBe(false);
    expect(result.current.loading).toBe(true);

    // The server knows the account the local copy predates.
    await act(async () => release([claudeAccount]));
    await waitFor(() => expect(result.current.readings).toHaveLength(1));
    expect(result.current.accountUnavailable).toBe(false);
  });

  it('shows the account as unavailable when the first account read fails', async () => {
    mockQuotaService.listAccounts.mockRejectedValue(new Error('offline'));
    const { result } = open();

    await waitFor(() => expect(result.current.accountUnavailable).toBe(true));
    expect(result.current.loading).toBe(false);
  });
});
