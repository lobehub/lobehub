/**
 * @vitest-environment happy-dom
 *
 * The document page's floating chat panel resolves its topic from the local
 * copy after a reload, before `getOrCreateChatTopic` answers. Each "reload"
 * re-imports the module graph (fresh stores, fresh SWR cache) over the same
 * IndexedDB.
 */
import { randomUUID } from 'node:crypto';

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

const PARAMS = { agentId: 'agent-1', documentId: 'docs_1' };

const pending = () => new Promise<never>(() => {});

/** A fresh module graph: what a page reload starts from (IndexedDB survives). */
const reload = async () => {
  cleanup();
  vi.resetModules();
  const [{ useDocumentChatTopic }, { agentDocumentService }] = await Promise.all([
    import('./useDocumentChatTopic'),
    import('@/services/agentDocument'),
  ]);
  const getOrCreate = vi.spyOn(agentDocumentService, 'getOrCreateChatTopic');
  const render = (params: { agentId?: string; documentId?: string } = PARAMS) =>
    renderHook(
      () => useDocumentChatTopic({ agentId: params.agentId, documentId: params.documentId }),
      { wrapper },
    );
  return { getOrCreate, render };
};

/** Let the server answer reach the persisted copy before the next reload. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

// Re-importing the module graph per reload is slow on a cold transform cache.
describe('useDocumentChatTopic across a reload', { timeout: 60_000 }, () => {
  beforeEach(() => {
    scope.current = `doc-topic-user-${randomUUID()}:personal`;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('resolves the previous session’s topic before the server answers, then follows it', async () => {
    const first = await reload();
    first.getOrCreate.mockResolvedValue({ topicId: 'tpc_doc' });
    const { result } = first.render();
    await waitFor(() => expect(result.current.topicId).toBe('tpc_doc'));
    await settle();

    const second = await reload();
    let answer!: (value: { topicId: string }) => void;
    second.getOrCreate.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const reloaded = second.render();

    await waitFor(() => expect(reloaded.result.current.topicId).toBe('tpc_doc'));
    expect(second.getOrCreate).toHaveBeenCalledWith(PARAMS);

    // The topic was deleted elsewhere and get-or-create provisioned a new one.
    await act(async () => {
      answer({ topicId: 'tpc_new' });
    });
    await waitFor(() => expect(reloaded.result.current.topicId).toBe('tpc_new'));
  });

  it('keeps each document’s topic apart', async () => {
    const first = await reload();
    first.getOrCreate.mockResolvedValue({ topicId: 'tpc_doc' });
    first.render();
    await settle();

    const second = await reload();
    second.getOrCreate.mockImplementation(pending);
    const other = second.render({ agentId: 'agent-2', documentId: 'docs_1' });
    await settle();

    expect(other.result.current.topicId).toBeUndefined();
  });

  it('does not resolve another identity’s topic', async () => {
    const first = await reload();
    first.getOrCreate.mockResolvedValue({ topicId: 'tpc_doc' });
    first.render();
    await settle();

    scope.current = `doc-topic-user-${randomUUID()}:personal`;
    const second = await reload();
    second.getOrCreate.mockImplementation(pending);
    const { result } = second.render();
    await settle();

    expect(result.current.topicId).toBeUndefined();
  });

  it('does not call get-or-create before ownership is proven', async () => {
    const first = await reload();
    first.render({ agentId: undefined, documentId: undefined });
    await settle();

    expect(first.getOrCreate).not.toHaveBeenCalled();
  });
});
