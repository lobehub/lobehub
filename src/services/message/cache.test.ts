import type { UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGE_CACHE_VERSION } from '@/libs/swr/keys';

import {
  clearMessageListClientCacheState,
  getEarlierHistoryStatus,
  getMessageListFetchPolicy,
  invalidateMessageListClientState,
  isMessageListServerVerified,
  loadEarlierMessagePage,
  MESSAGE_LIST_VERIFICATION_INTERVAL,
  messageListKey,
  type MessageListPage,
  runMessageListQuery,
} from './cache';

const getCacheScopeMock = vi.hoisted(() => vi.fn(() => 'user-1:personal'));

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: getCacheScopeMock,
}));

const context = { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' };
const messages = [
  { content: 'hello', createdAt: 1, id: 'message-1', role: 'user', updatedAt: 1 },
] as UIChatMessage[];

const deferred = <T>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

beforeEach(() => {
  clearMessageListClientCacheState();
  getCacheScopeMock.mockReturnValue('user-1:personal');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('message list client cache', () => {
  it('normalizes equivalent UI contexts to one canonical v2 SWR key', () => {
    const conversationContext = {
      agentId: 'agent-1',
      documentId: undefined,
      scope: 'main',
      threadId: null,
      topicId: 'topic-1',
      workspaceSlug: 'workspace',
    };

    expect(messageListKey(context)).toEqual(messageListKey(conversationContext));
    expect(messageListKey(conversationContext)).toEqual([
      'message:list',
      {
        agentId: 'agent-1',
        groupId: null,
        threadId: null,
        topicId: 'topic-1',
      },
      MESSAGE_CACHE_VERSION,
    ]);
  });

  it('marks only a successful server query verified for thirty seconds', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const query = vi.fn().mockResolvedValue(messages);
    await expect(runMessageListQuery(context, query)).resolves.toBe(messages);
    const verifiedAt = 1000;

    expect(
      isMessageListServerVerified(context, verifiedAt + MESSAGE_LIST_VERIFICATION_INTERVAL - 1),
    ).toBe(true);
    expect(getMessageListFetchPolicy(context)).toEqual({
      dedupingInterval: MESSAGE_LIST_VERIFICATION_INTERVAL,
      revalidateIfStale: false,
    });
    expect(
      isMessageListServerVerified(context, verifiedAt + MESSAGE_LIST_VERIFICATION_INTERVAL),
    ).toBe(false);
  });

  it('treats a successful empty server result as verified', async () => {
    await expect(runMessageListQuery(context, async () => [])).resolves.toEqual([]);
    expect(isMessageListServerVerified(context)).toBe(true);
  });

  it('clears prior verification when a real revalidation fails', async () => {
    await runMessageListQuery(context, async () => messages);
    expect(isMessageListServerVerified(context)).toBe(true);

    await expect(
      runMessageListQuery(context, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');

    expect(isMessageListServerVerified(context)).toBe(false);
    expect(getMessageListFetchPolicy(context).revalidateIfStale).toBe(true);
  });

  it('isolates verification and in-flight requests by identity cache scope', async () => {
    const firstScope = deferred<UIChatMessage[]>();
    const secondScope = deferred<UIChatMessage[]>();
    const query = vi
      .fn()
      .mockImplementationOnce(() => firstScope.promise)
      .mockImplementationOnce(() => secondScope.promise);

    const first = runMessageListQuery(context, query);
    await Promise.resolve();
    getCacheScopeMock.mockReturnValue('user-1:workspace-2');
    const second = runMessageListQuery(context, query);
    await Promise.resolve();

    expect(query).toHaveBeenCalledTimes(2);
    secondScope.resolve(messages);
    await expect(second).resolves.toBe(messages);
    expect(isMessageListServerVerified(context)).toBe(true);

    getCacheScopeMock.mockReturnValue('user-1:personal');
    expect(isMessageListServerVerified(context)).toBe(false);
    firstScope.resolve(messages);
    await expect(first).resolves.toBe(messages);
    expect(isMessageListServerVerified(context)).toBe(true);
  });

  it('shares one in-flight request across equivalent callers', async () => {
    const pending = deferred<UIChatMessage[]>();
    const query = vi.fn(() => pending.promise);

    const first = runMessageListQuery(context, query);
    const second = runMessageListQuery(
      { agentId: 'agent-1', threadId: null, topicId: 'topic-1' },
      query,
    );

    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);

    pending.resolve(messages);
    await expect(first).resolves.toBe(messages);
    await expect(second).resolves.toBe(messages);
  });

  it('invalidates verification even when no subscriber starts a replacement request', async () => {
    await runMessageListQuery(context, async () => messages);
    expect(isMessageListServerVerified(context)).toBe(true);

    invalidateMessageListClientState((candidate) => candidate.topicId === 'topic-1');

    expect(isMessageListServerVerified(context)).toBe(false);
    expect(getMessageListFetchPolicy(context).revalidateIfStale).toBe(true);
  });

  it('routes an invalidated in-flight caller through the current generation', async () => {
    const oldRequest = deferred<UIChatMessage[]>();
    const currentRequest = deferred<UIChatMessage[]>();
    const query = vi
      .fn()
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => currentRequest.promise);
    const oldMessages = [{ ...messages[0], content: 'old' }];
    const currentMessages = [{ ...messages[0], content: 'current' }];

    const first = runMessageListQuery(context, query);
    await Promise.resolve();
    invalidateMessageListClientState((candidate) => candidate.topicId === 'topic-1');
    const current = runMessageListQuery(context, query);
    await Promise.resolve();

    // Let the current generation finish before the invalidated request. The
    // late request must reuse this settled result instead of starting a third
    // query or publishing its obsolete snapshot.
    currentRequest.resolve(currentMessages);
    await expect(current).resolves.toEqual(currentMessages);
    oldRequest.resolve(oldMessages);

    await expect(first).resolves.toEqual(currentMessages);
    expect(query).toHaveBeenCalledTimes(2);
    expect(isMessageListServerVerified(context)).toBe(true);
  });

  it('replaces an invalidated request even when the old generation fails', async () => {
    const oldRequest = deferred<UIChatMessage[]>();
    const currentRequest = deferred<UIChatMessage[]>();
    const query = vi
      .fn()
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => currentRequest.promise);

    const first = runMessageListQuery(context, query);
    await Promise.resolve();
    invalidateMessageListClientState((candidate) => candidate.topicId === 'topic-1');
    oldRequest.reject(new Error('obsolete failure'));

    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    currentRequest.resolve(messages);
    await expect(first).resolves.toBe(messages);
    expect(isMessageListServerVerified(context)).toBe(true);
  });

  it('starts a new retry after a retained current-generation request failed', async () => {
    const oldRequest = deferred<UIChatMessage[]>();
    const failedCurrentRequest = deferred<UIChatMessage[]>();
    const retryRequest = deferred<UIChatMessage[]>();
    const query = vi
      .fn()
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => failedCurrentRequest.promise)
      .mockImplementationOnce(() => retryRequest.promise);

    const oldCaller = runMessageListQuery(context, query);
    await Promise.resolve();
    invalidateMessageListClientState((candidate) => candidate.topicId === 'topic-1');
    const currentCaller = runMessageListQuery(context, query);
    await Promise.resolve();
    failedCurrentRequest.reject(new Error('current failure'));
    await expect(currentCaller).rejects.toThrow('current failure');

    const retryCaller = runMessageListQuery(context, query);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(3));
    retryRequest.resolve(messages);
    await expect(retryCaller).resolves.toBe(messages);

    oldRequest.resolve([{ ...messages[0], content: 'obsolete' }]);
    await expect(oldCaller).resolves.toBe(messages);
    expect(isMessageListServerVerified(context)).toBe(true);
  });

  it('prunes the oldest settled verification state after the client cache reaches its limit', async () => {
    for (let index = 0; index <= 500; index += 1) {
      await runMessageListQuery(
        { agentId: 'agent-1', topicId: `topic-${index}` },
        async () => messages,
      );
    }

    expect(isMessageListServerVerified({ agentId: 'agent-1', topicId: 'topic-0' })).toBe(false);
    expect(isMessageListServerVerified({ agentId: 'agent-1', topicId: 'topic-500' })).toBe(true);
  });
});

describe('earlier history (round-cursor pages, LOBE-13716)', () => {
  const message = (id: string, createdAt: number, role = 'assistant') =>
    ({ content: id, createdAt, id, role, updatedAt: createdAt }) as unknown as UIChatMessage;

  const ids = (list: UIChatMessage[] | undefined) => list?.map((item) => item.id);

  /** A page from a read path that reports no round cursor (older history unknown). */
  const asPage = (messages: UIChatMessage[]): MessageListPage => ({ messages });

  it('fetches a page older than the oldest mainline row and returns the merged transcript', async () => {
    const window = [message('u2', 10, 'user'), message('a2', 11)];
    const fetcher = vi.fn().mockResolvedValue(asPage([message('u1', 1, 'user'), message('a1', 2)]));

    const merged = await loadEarlierMessagePage(context, () => window, fetcher);

    expect(fetcher).toHaveBeenCalledWith({ createdAt: new Date(10).toISOString(), id: 'u2' });
    expect(ids(merged)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('never uses a synthetic group node as the round cursor', async () => {
    const window = [message('group-1', 5, 'compressedGroup'), message('u2', 10, 'user')];
    const fetcher = vi.fn().mockResolvedValue(asPage([message('u1', 1, 'user')]));

    await loadEarlierMessagePage(context, () => window, fetcher);

    expect(fetcher).toHaveBeenCalledWith({ createdAt: new Date(10).toISOString(), id: 'u2' });
  });

  it('re-attaches loaded history to later revalidations of the same identity', async () => {
    const window = [message('u2', 10, 'user'), message('a2', 11)];
    await loadEarlierMessagePage(
      context,
      () => window,
      async () => asPage([message('u1', 1, 'user')]),
    );

    const revalidated = await runMessageListQuery(context, async () => window);

    expect(ids(revalidated)).toEqual(['u1', 'u2', 'a2']);
  });

  it('drops cached pages when the fresh window slid past the join point', async () => {
    const window = [message('u2', 10, 'user'), message('a2', 11)];
    await loadEarlierMessagePage(
      context,
      () => window,
      async () => asPage([message('u1', 1, 'user')]),
    );

    // The window moved forward: u2 (the join point) fell out of it. Merging
    // would leave an invisible gap, so the transcript collapses to the window.
    const slidWindow = [message('u3', 20, 'user'), message('a3', 21)];
    const revalidated = await runMessageListQuery(context, async () => slidWindow);

    expect(revalidated).toBe(slidWindow);
  });

  it('deduplicates rows the fresh window already contains', async () => {
    const window = [message('u2', 10, 'user'), message('a2', 11)];
    await loadEarlierMessagePage(
      context,
      () => window,
      async () => asPage([message('u1', 1, 'user'), message('a1', 2)]),
    );

    // A later window that reaches further back overlaps the cached page.
    const extendedWindow = [message('a1', 2), message('u2', 10, 'user'), message('a2', 11)];
    const revalidated = await runMessageListQuery(context, async () => extendedWindow);

    expect(ids(revalidated)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('marks the identity exhausted only on an empty page and stops fetching', async () => {
    const window = [message('u1', 10, 'user')];
    const fetcher = vi.fn().mockResolvedValue(asPage([]));

    const merged = await loadEarlierMessagePage(context, () => window, fetcher);

    expect(merged).toBeUndefined();
    expect(getEarlierHistoryStatus(context).exhausted).toBe(true);

    await loadEarlierMessagePage(context, () => window, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('ignores a second load while one page is in flight', async () => {
    const window = [message('u2', 10, 'user')];
    const firstPage = deferred<UIChatMessage[]>();
    const fetcher = vi.fn().mockReturnValue(firstPage.promise.then(asPage));

    const first = loadEarlierMessagePage(context, () => window, fetcher);
    const second = await loadEarlierMessagePage(context, () => window, fetcher);

    expect(second).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);

    firstPage.resolve([message('u1', 1, 'user')]);
    expect(ids(await first)).toEqual(['u1', 'u2']);
  });

  it('merges the page into the latest transcript, not the one at request time', async () => {
    let current = [message('u2', 10, 'user')];
    const page = deferred<UIChatMessage[]>();

    const pending = loadEarlierMessagePage(
      context,
      () => current,
      () => page.promise.then(asPage),
    );
    // A stream appends a reply while the page is in flight.
    current = [message('u2', 10, 'user'), message('a2', 11)];
    page.resolve([message('u1', 1, 'user')]);

    expect(ids(await pending)).toEqual(['u1', 'u2', 'a2']);
  });

  it('discards a page whose identity was invalidated while in flight', async () => {
    const window = [message('u2', 10, 'user')];
    const page = deferred<UIChatMessage[]>();

    const pending = loadEarlierMessagePage(
      context,
      () => window,
      () => page.promise.then(asPage),
    );
    invalidateMessageListClientState(() => true);
    page.resolve([message('u1', 1, 'user')]);

    expect(await pending).toBeUndefined();
    const revalidated = await runMessageListQuery(context, async () => window);
    expect(revalidated).toBe(window);
  });

  it('skips the merge when the caller no longer has a transcript to extend', async () => {
    let current: UIChatMessage[] | undefined = [message('u2', 10, 'user')];
    const page = deferred<UIChatMessage[]>();

    const pending = loadEarlierMessagePage(
      context,
      () => current,
      () => page.promise.then(asPage),
    );
    current = undefined;
    page.resolve([message('u1', 1, 'user')]);

    expect(await pending).toBeUndefined();
    // The page is still remembered for the next revalidation of this identity.
    const revalidated = await runMessageListQuery(context, async () => [message('u2', 10, 'user')]);
    expect(ids(revalidated)).toEqual(['u1', 'u2']);
  });

  it('clears cached history on invalidation so stale rows cannot resurrect', async () => {
    const window = [message('u2', 10, 'user')];
    await loadEarlierMessagePage(
      context,
      () => window,
      async () => asPage([message('u1', 1, 'user')]),
    );

    invalidateMessageListClientState(() => true);

    const revalidated = await runMessageListQuery(context, async () => window);
    expect(revalidated).toBe(window);
  });

  describe('with a round cursor reported by the server', () => {
    const cursorOf = (id: string, createdAt: string) => ({ createdAt, id });

    it('never fetches when the window already holds the topic start', async () => {
      const window = [message('u1', 10, 'user'), message('a1', 11)];
      await runMessageListQuery(context, async () => ({ messages: window, olderCursor: null }));
      const fetcher = vi.fn();

      const merged = await loadEarlierMessagePage(context, () => window, fetcher);

      expect(merged).toBeUndefined();
      expect(fetcher).not.toHaveBeenCalled();
      expect(getEarlierHistoryStatus(context).exhausted).toBe(true);
    });

    it("pages from the window's lossless cursor instead of the oldest row", async () => {
      const window = [message('u2', 10, 'user'), message('a2', 11)];
      const windowCursor = cursorOf('u2', '1970-01-01T00:00:00.010123Z');
      await runMessageListQuery(context, async () => ({
        messages: window,
        olderCursor: windowCursor,
      }));
      const fetcher = vi
        .fn()
        .mockResolvedValue({ messages: [message('u1', 1, 'user')], olderCursor: null });

      const merged = await loadEarlierMessagePage(context, () => window, fetcher);

      expect(fetcher).toHaveBeenCalledWith(windowCursor);
      expect(ids(merged)).toEqual(['u1', 'u2', 'a2']);
    });

    it('stops after the page that reached the topic start', async () => {
      const window = [message('u3', 20, 'user')];
      await runMessageListQuery(context, async () => ({
        messages: window,
        olderCursor: cursorOf('u3', '1970-01-01T00:00:00.020Z'),
      }));
      const olderCursor = cursorOf('u2', '1970-01-01T00:00:00.010Z');
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce({ messages: [message('u2', 10, 'user')], olderCursor })
        .mockResolvedValueOnce({ messages: [message('u1', 1, 'user')], olderCursor: null });

      let current: UIChatMessage[] = window;
      current = (await loadEarlierMessagePage(context, () => current, fetcher)) ?? current;
      current = (await loadEarlierMessagePage(context, () => current, fetcher)) ?? current;
      await loadEarlierMessagePage(context, () => current, fetcher);

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher).toHaveBeenLastCalledWith(olderCursor);
      expect(ids(current)).toEqual(['u1', 'u2', 'u3']);
      expect(getEarlierHistoryStatus(context).exhausted).toBe(true);
    });
  });

  it('evicts the least-recently-used identity once the earlier-history cache is full', async () => {
    const window = [message('u2', 10, 'user')];
    const oldest = { ...context, topicId: 'topic-evicted' };
    // Exhaust the first identity, then flood the cache with 30 more.
    await loadEarlierMessagePage(
      oldest,
      () => window,
      async () => asPage([]),
    );
    expect(getEarlierHistoryStatus(oldest).exhausted).toBe(true);

    for (let i = 0; i < 30; i++) {
      await loadEarlierMessagePage(
        { ...context, topicId: `topic-fill-${i}` },
        () => window,
        async () => asPage([message('u1', 1, 'user')]),
      );
    }

    // The exhausted marker was evicted with the entry: the identity fetches again.
    expect(getEarlierHistoryStatus(oldest).exhausted).toBe(false);
    const fetcher = vi.fn().mockResolvedValue(asPage([]));
    await loadEarlierMessagePage(oldest, () => window, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // The most recent identity survives: its cached page still re-attaches.
    const survivor = { ...context, topicId: 'topic-fill-29' };
    const revalidated = await runMessageListQuery(survivor, async () => window);
    expect(ids(revalidated)).toEqual(['u1', 'u2']);
  });
});
