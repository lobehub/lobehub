import type { UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGE_CACHE_VERSION } from '@/libs/swr/keys';

import {
  clearMessageListClientCacheState,
  getMessageListFetchPolicy,
  invalidateMessageListClientState,
  isMessageListServerVerified,
  MESSAGE_LIST_VERIFICATION_INTERVAL,
  messageListKey,
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
