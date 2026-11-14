/**
 * @vitest-environment happy-dom
 *
 * Agent Signal receipts survive a reload: the receipt chips of a topic paint
 * from the local copy before the network answers, then follow the server.
 * Each "reload" re-imports the module graph (fresh stores, fresh SWR cache)
 * over the same IndexedDB.
 */
import { randomUUID } from 'node:crypto';

import type { UIChatMessage } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ current: '' }));

vi.mock('@/libs/swr/useCacheScope', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCacheScope: () => scope.current,
  isScopeTrusted: () => true,
  useCacheScope: () => scope.current,
}));
vi.mock('@/libs/swr', async (importOriginal) => {
  const swr = await import('swr');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    mutate: swr.mutate,
    useClientDataSWR: swr.default,
  };
});

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const receipt = (id: string, createdAt: number, overrides: Record<string, unknown> = {}) => ({
  agentId: 'agent-1',
  anchorMessageId: 'assistant-1',
  createdAt,
  detail: 'Saved this for future replies',
  id,
  kind: 'memory' as const,
  sourceId: 'source-1',
  sourceType: 'client.gateway.runtime_end',
  status: 'applied' as const,
  title: `Memory ${id}`,
  topicId: 'topic-1',
  userId: 'user-1',
  ...overrides,
});

const displayMessages = [
  { content: '', createdAt: 1, id: 'assistant-1', role: 'assistant', updatedAt: 1 },
] as UIChatMessage[];

const pending = () => new Promise<never>(() => {});

/** A fresh module graph: what a page reload starts from (IndexedDB survives). */
const reload = async () => {
  cleanup();
  vi.resetModules();
  const [{ useAgentSignalReceipts }, { agentSignalService }] = await Promise.all([
    import('./useAgentSignalReceipts'),
    import('@/services/agentSignal'),
  ]);
  const listReceipts = vi.spyOn(agentSignalService, 'listReceipts');
  /** The main conversation and a floating panel on the same topic (one SWR cache). */
  const renderTwo = () =>
    renderHook(
      () => {
        const input = { agentId: 'agent-1', displayMessages, enabled: true, topicId: 'topic-1' };
        useAgentSignalReceipts(input);
        return useAgentSignalReceipts(input);
      },
      { wrapper },
    );
  const render = (topicId = 'topic-1') =>
    renderHook(
      () =>
        useAgentSignalReceipts({
          agentId: 'agent-1',
          displayMessages,
          enabled: true,
          topicId,
        }),
      { wrapper },
    );
  return { listReceipts, render, renderTwo };
};

const titles = (result: { current: { receiptsByAnchor: Map<string, { title: string }[]> } }) =>
  (result.current.receiptsByAnchor.get('assistant-1') ?? []).map((r) => r.title);

/** Let the server answer reach the persisted copy before the next reload. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

// Re-importing the module graph per reload is slow on a cold transform cache.
describe('useAgentSignalReceipts across a reload', { timeout: 60_000 }, () => {
  beforeEach(() => {
    scope.current = `receipts-user-${randomUUID()}:personal`;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('paints the previous session’s receipts before the network answers, then follows the server', async () => {
    const first = await reload();
    first.listReceipts.mockResolvedValue({ cursor: undefined, receipts: [receipt('a', 2)] });
    const { result } = first.render();
    await waitFor(() => expect(titles(result)).toEqual(['Memory a']));
    await settle();

    const second = await reload();
    let answer!: (value: Awaited<ReturnType<typeof second.listReceipts>>) => void;
    second.listReceipts.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const reloaded = second.render();

    // Painted from the local copy while the request is still in flight…
    await waitFor(() => expect(titles(reloaded.result)).toEqual(['Memory a']));
    // …and the first read after a reload is a full head, not an increment.
    expect(second.listReceipts).toHaveBeenCalledWith({
      agentId: 'agent-1',
      limit: 20,
      topicId: 'topic-1',
    });

    await act(async () => {
      answer({ cursor: undefined, receipts: [receipt('b', 3), receipt('a', 2)] });
    });
    await waitFor(() => expect(titles(reloaded.result)).toEqual(['Memory b', 'Memory a']));
  });

  it('keeps the receipts on screen when the refresh fails', async () => {
    const first = await reload();
    first.listReceipts.mockResolvedValue({ cursor: undefined, receipts: [receipt('a', 2)] });
    first.render();
    await settle();

    const second = await reload();
    second.listReceipts.mockRejectedValue(new Error('offline'));
    const { result } = second.render();

    await waitFor(() => expect(second.listReceipts).toHaveBeenCalled());
    await settle();
    expect(titles(result)).toEqual(['Memory a']);
  });

  it('does not show another identity’s receipts', async () => {
    const first = await reload();
    first.listReceipts.mockResolvedValue({ cursor: undefined, receipts: [receipt('a', 2)] });
    first.render();
    await settle();

    scope.current = `receipts-user-${randomUUID()}:personal`;
    const second = await reload();
    second.listReceipts.mockImplementation(pending);
    const { result } = second.render();
    await settle();

    expect(titles(result)).toEqual([]);
  });

  it('asks the server once for two views of the same topic', async () => {
    const first = await reload();
    first.listReceipts.mockResolvedValue({ cursor: undefined, receipts: [receipt('a', 2)] });
    first.renderTwo();
    await settle();

    expect(first.listReceipts).toHaveBeenCalledTimes(1);
  });

  it('remembers an undone receipt across a reload', async () => {
    const first = await reload();
    first.listReceipts.mockResolvedValue({
      cursor: undefined,
      receipts: [receipt('a', 2, { metadata: { rollbackStatus: 'available' } })],
    });
    const { result } = first.render();
    await waitFor(() => expect(titles(result)).toEqual(['Memory a']));

    const { agentSignalActions } = await import('@/store/agentSignal');
    act(() => {
      agentSignalActions.markReceiptRolledBack({ agentId: 'agent-1', topicId: 'topic-1' }, 'a');
    });
    await settle();

    const second = await reload();
    second.listReceipts.mockImplementation(pending);
    const reloaded = second.render();

    await waitFor(() =>
      expect(
        reloaded.result.current.receiptsByAnchor.get('assistant-1')?.[0]?.metadata?.rollbackStatus,
      ).toBe('rolled_back'),
    );
  });
});
