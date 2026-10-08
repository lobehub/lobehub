import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ listInbox: vi.fn() }));
vi.mock('@/services/agentAccount', () => ({ agentAccountService: service }));

const { INBOX_PAGE_SIZE, useAgentInbox } = await import('./useAgentIdentity');

const page = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ from: `sender${i}@example.com`, id: `msg_${i}` }));

/** A fresh cache per test, so one case cannot answer another's read. */
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAgentInbox', () => {
  it('reads the newest page first', async () => {
    service.listInbox.mockResolvedValue(page(3));

    const { result } = renderHook(() => useAgentInbox('agt_1'), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(service.listInbox).toHaveBeenCalledWith({ agentId: 'agt_1', limit: INBOX_PAGE_SIZE });
  });

  it('widens the window so older mail stays reachable', async () => {
    service.listInbox.mockResolvedValueOnce(page(INBOX_PAGE_SIZE));
    service.listInbox.mockResolvedValue(page(INBOX_PAGE_SIZE * 2));

    const { result } = renderHook(() => useAgentInbox('agt_1'), { wrapper });

    // A window that came back full means the inbox may hold older mail, so the
    // reader is offered a way to reach it instead of a silent cut-off.
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());

    await waitFor(() =>
      expect(service.listInbox).toHaveBeenLastCalledWith({
        agentId: 'agt_1',
        limit: INBOX_PAGE_SIZE * 2,
      }),
    );
    expect(result.current.data).toHaveLength(INBOX_PAGE_SIZE * 2);
  });

  it('reports nothing more when the window came back short', async () => {
    service.listInbox.mockResolvedValue(page(INBOX_PAGE_SIZE - 1));

    const { result } = renderHook(() => useAgentInbox('agt_1'), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(INBOX_PAGE_SIZE - 1));
    expect(result.current.hasMore).toBe(false);
  });
});
