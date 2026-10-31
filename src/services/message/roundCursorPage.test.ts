import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { MessageService } from './index';
import {
  ForwardPagingUnsupportedError,
  isPartialHeadWindow,
  primeMessageListPage,
  readMessagesByRoundCursor,
  readMessagesForward,
  SHARED_TOPIC_FIRST_PAGE,
  toRoundCursorQueryInput,
} from './roundCursorPage';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    message: {
      getMessages: { query: vi.fn() },
      getMessagesByCursor: { query: vi.fn() },
    },
  },
}));

const query = vi.mocked(lambdaClient.message.getMessagesByCursor.query);

const page = (id: string) => ({ hasMore: false, messages: [{ id }], nextCursor: null }) as any;
const listPage = (id: string) => Promise.resolve({ messages: [{ id }], olderCursor: null } as any);

let seq = 0;
// The primed map is module state: give every test its own conversation.
const nextContext = () => ({ agentId: 'agent-1', topicId: 'topic-1', topicShareId: `s${++seq}` });

describe('toRoundCursorQueryInput', () => {
  it('requests 500-row gateway pages for the initial window and older history', async () => {
    query.mockReset();
    const service = new MessageService();
    const context = { ...nextContext(), projectToolPayloads: true };
    const cursor = { createdAt: '2026-01-01T00:00:00.000000Z', id: 'oldest-head' };
    const messages = Array.from({ length: 500 }, (_, index) => ({ id: `head-${index}` }));
    query.mockResolvedValueOnce({ ...page('head'), hasMore: true, messages, nextCursor: cursor });
    query.mockResolvedValueOnce(page('older'));

    const head = await service.getMessageListPage(context);
    const older = await service.getEarlierMessages(context, cursor);

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ countBudget: 500, cursor: null, projectToolPayloads: true }),
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ countBudget: 500, cursor, projectToolPayloads: true }),
    );
    expect(head).toEqual({ messages, olderCursor: cursor });
    expect(older).toEqual({ messages: [{ id: 'older' }], olderCursor: null });
  });

  it('keeps the full window for client-mode reads', () => {
    const input = toRoundCursorQueryInput({ agentId: 'a', topicId: 't' }, null);

    expect(input).toMatchObject({ countBudget: 1000, roundLimit: 1000 });
  });
});

describe('partial head window', () => {
  const older = { createdAt: '2026-01-01T00:00:00.000000Z', id: 'u1' };

  it('marks a gateway head page that has older history', async () => {
    const context = nextContext();
    query.mockResolvedValueOnce({ ...page('m'), hasMore: true, nextCursor: older });

    await readMessagesByRoundCursor({ ...context, projectToolPayloads: true }, null);

    expect(isPartialHeadWindow(context)).toBe(true);
  });

  it('clears the mark once a full-budget head page lands', async () => {
    const context = nextContext();
    query.mockResolvedValueOnce({ ...page('m'), hasMore: true, nextCursor: older });
    await readMessagesByRoundCursor({ ...context, projectToolPayloads: true }, null);
    query.mockResolvedValueOnce({ ...page('m'), hasMore: true, nextCursor: older });

    await readMessagesByRoundCursor(context, null);

    expect(isPartialHeadWindow(context)).toBe(false);
  });

  it('does not mark a gateway head page that holds the whole topic', async () => {
    const context = nextContext();
    query.mockResolvedValueOnce(page('m'));

    await readMessagesByRoundCursor({ ...context, projectToolPayloads: true }, null);

    expect(isPartialHeadWindow(context)).toBe(false);
  });
});

describe('primeMessageListPage', () => {
  const service = new MessageService();

  beforeEach(() => {
    query.mockReset();
  });

  it('answers the first list read without a request', async () => {
    const context = nextContext();

    primeMessageListPage(context, listPage('primed'));

    // The list asks with its own read options; projection is not part of the identity.
    const result = await service.getMessageListPage({ ...context, projectToolPayloads: true });

    expect(query).not.toHaveBeenCalled();
    expect(result).toEqual({ messages: [{ id: 'primed' }], olderCursor: null });
  });

  it('is taken once: later reads go to the server', async () => {
    query.mockResolvedValueOnce(page('fresh'));
    const context = nextContext();

    primeMessageListPage(context, listPage('primed'));
    await service.getMessageListPage(context);
    const second = await service.getMessageListPage(context);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null, topicShareId: context.topicShareId }),
    );
    expect(second).toEqual({ messages: [{ id: 'fresh' }], olderCursor: null });
  });

  it('keeps the first page primed for a conversation', async () => {
    const context = nextContext();

    primeMessageListPage(context, listPage('first'));
    primeMessageListPage({ ...context }, listPage('second'));

    expect(await service.getMessageListPage(context)).toEqual({
      messages: [{ id: 'first' }],
      olderCursor: null,
    });
  });

  it('is not handed to a different conversation', async () => {
    query.mockResolvedValueOnce(page('group'));
    const context = nextContext();

    primeMessageListPage(context, listPage('primed'));
    const result = await service.getMessageListPage({ ...context, groupId: 'group-1' });

    expect(query).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ messages: [{ id: 'group' }], olderCursor: null });
  });

  it('falls back to a fresh read when the primed request failed', async () => {
    query.mockResolvedValueOnce(page('retry'));
    const context = nextContext();

    primeMessageListPage(context, Promise.reject(new Error('network')));
    const result = await service.getMessageListPage(context);

    expect(query).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ messages: [{ id: 'retry' }], olderCursor: null });
  });
});

describe('readMessagesForward', () => {
  const forwardClient = (response: unknown) => {
    const forwardQuery = vi.fn().mockResolvedValue(response);
    return {
      client: { message: { getMessagesByCursor: { query: forwardQuery } } } as any,
      forwardQuery,
    };
  };
  const context = { agentId: 'agent-1', topicId: 'topic-1', topicShareId: 'share-1' };

  it('asks for a forward page of the given size', async () => {
    const { client, forwardQuery } = forwardClient({
      direction: 'forward',
      hasMore: false,
      messages: [],
      nextCursor: null,
    });

    await readMessagesForward(client, context, null, SHARED_TOPIC_FIRST_PAGE);

    expect(forwardQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        countBudget: SHARED_TOPIC_FIRST_PAGE.countBudget,
        cursor: null,
        direction: 'forward',
        roundLimit: SHARED_TOPIC_FIRST_PAGE.roundLimit,
        topicShareId: 'share-1',
      }),
    );
  });

  it('returns the page with the cursor for the rounds after it', async () => {
    const cursor = { createdAt: '2024-01-01T00:00:01.000000Z', id: 'a1' };
    const { client } = forwardClient({
      direction: 'forward',
      hasMore: true,
      messages: [{ id: 'u1' }, { id: 'a1' }],
      nextCursor: cursor,
    });

    const page = await readMessagesForward(client, context, null);

    expect(page).toEqual({ messages: [{ id: 'u1' }, { id: 'a1' }], newerCursor: cursor });
  });

  it.each([undefined, 'backward'])(
    'refuses a page the server did not read forward (echo: %s)',
    async (direction) => {
      const { client } = forwardClient({
        direction,
        hasMore: false,
        messages: [{ id: 'newest' }],
        nextCursor: null,
      });

      await expect(readMessagesForward(client, context, null)).rejects.toBeInstanceOf(
        ForwardPagingUnsupportedError,
      );
    },
  );
});
