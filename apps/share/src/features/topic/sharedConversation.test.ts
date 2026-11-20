/**
 * @vitest-environment happy-dom
 */
import superjson from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { MessageService } from '@/services/message';
import {
  SHARED_TOPIC_FIRST_PAGE,
  takePrimedForwardMessagePage,
  toRoundCursorQueryInput,
} from '@/services/message/roundCursorPage';

import {
  primeSharedTopicMessages,
  readSharedTopicFirstPage,
  SHARED_TOPIC_FIRST_PAGE_MAX_CHARS,
  sharedTopicMessagesScript,
  sharedTopicMessagesUrl,
  toSharedConversationContext,
} from './sharedConversation';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    message: {
      getMessages: { query: vi.fn() },
      getMessagesByCursor: { query: vi.fn() },
    },
  },
}));

const query = vi.mocked(lambdaClient.message.getMessagesByCursor.query);
const fetchMock = vi.fn();

let seq = 0;
const topic = (overrides: Record<string, unknown> = {}) =>
  ({
    agentId: 'agent-1',
    groupId: null,
    shareId: `share-${++seq}`,
    topicId: 'topic-1',
    ...overrides,
  }) as any;

const BACKWARD = { firstPage: null, messageReadMode: 'backward' } as const;

const trpcBody = (data: unknown) => ({ result: { data: superjson.serialize(data) } });

const runDocumentScript = (shared: ReturnType<typeof topic>) =>
  new Function(sharedTopicMessagesScript(shared))();

describe('sharedTopicMessagesScript', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    query.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.__LOBE_SHARED_TOPIC_MESSAGES__;
  });

  // The document reads for the list; any other input is a page the list would
  // not have asked for.
  it('requests the read the mounted list makes', () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    const shared = topic({ groupId: 'group-1' });

    runDocumentScript(shared);

    const [url, init] = fetchMock.mock.calls[0];
    const input = new URL(url, 'http://share.test').searchParams.get('input')!;
    expect(superjson.deserialize(JSON.parse(input))).toEqual(
      toRoundCursorQueryInput(toSharedConversationContext(shared), null),
    );
    expect(init).toMatchObject({ credentials: 'include' });
    expect(window.__LOBE_SHARED_TOPIC_MESSAGES__?.shareId).toBe(shared.shareId);
  });

  it('cannot be closed by a share id from the URL', () => {
    const script = sharedTopicMessagesScript(topic({ shareId: '</script><script>alert(1)//' }));

    expect(script).not.toContain('</script');
  });

  it('skips a share the list would not read', () => {
    expect(sharedTopicMessagesScript(topic({ agentId: null }))).toBe('');
  });

  it('hands the document read to the list without a second request', async () => {
    const shared = topic();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(trpcBody({ messages: [{ id: 'm1' }], nextCursor: null }))),
    );

    runDocumentScript(shared);
    primeSharedTopicMessages(shared, BACKWARD);
    const page = await new MessageService().getMessageListPage(toSharedConversationContext(shared));

    expect(page).toEqual({ messages: [{ id: 'm1' }], olderCursor: null });
    expect(query).not.toHaveBeenCalled();
    expect(window.__LOBE_SHARED_TOPIC_MESSAGES__).toBeUndefined();
  });

  it('lets the list read for itself when the document read failed', async () => {
    const shared = topic();
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    query.mockResolvedValue({
      hasMore: false,
      messages: [{ id: 'retry' }],
      nextCursor: null,
    } as any);

    runDocumentScript(shared);
    primeSharedTopicMessages(shared, BACKWARD);
    const page = await new MessageService().getMessageListPage(toSharedConversationContext(shared));

    expect(page).toEqual({ messages: [{ id: 'retry' }], olderCursor: null });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('is not handed to another share', async () => {
    const shared = topic();
    fetchMock.mockResolvedValue(new Response('{}'));
    query.mockResolvedValue({ hasMore: false, messages: [], nextCursor: null } as any);

    runDocumentScript(shared);
    const other = topic();
    primeSharedTopicMessages(other, BACKWARD);
    await new MessageService().getMessageListPage(toSharedConversationContext(other));

    expect(query).toHaveBeenCalledTimes(1);
    expect(sharedTopicMessagesUrl(other)).not.toBe(sharedTopicMessagesUrl(shared));
  });
});

describe('readSharedTopicFirstPage', () => {
  const serverClient = (impl: () => Promise<unknown>) => {
    const serverQuery = vi.fn(impl);
    return {
      client: { message: { getMessagesByCursor: { query: serverQuery } } } as any,
      serverQuery,
    };
  };

  it('leaves a first page too large to embed to the client, still forward', async () => {
    const heavy = 'x'.repeat(SHARED_TOPIC_FIRST_PAGE_MAX_CHARS);
    const { client } = serverClient(async () => ({
      direction: 'forward',
      hasMore: true,
      messages: [{ content: heavy, id: 'u1' }],
      nextCursor: null,
    }));

    await expect(readSharedTopicFirstPage(client, 'share-heavy')).resolves.toEqual({
      firstPage: null,
      messageReadMode: 'forward',
    });
  });

  it('reads the first rounds forward from the share id alone', async () => {
    const page = {
      direction: 'forward',
      hasMore: true,
      messages: [{ id: 'u1' }],
      nextCursor: null,
    };
    const { client, serverQuery } = serverClient(async () => page);

    const result = await readSharedTopicFirstPage(client, 'share-x');

    expect(result).toEqual({
      firstPage: { messages: [{ id: 'u1' }], newerCursor: null },
      messageReadMode: 'forward',
    });
    expect(serverQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        countBudget: SHARED_TOPIC_FIRST_PAGE.countBudget,
        direction: 'forward',
        roundLimit: SHARED_TOPIC_FIRST_PAGE.roundLimit,
        topicShareId: 'share-x',
      }),
    );
  });

  it('falls back to the newest-first page when the server cannot page forward', async () => {
    const { client } = serverClient(async () => ({
      hasMore: false,
      messages: [],
      nextCursor: null,
    }));

    expect(await readSharedTopicFirstPage(client, 'share-x')).toEqual({
      firstPage: null,
      messageReadMode: 'backward',
    });
  });

  it('leaves a failed read to the client while still paging forward', async () => {
    const { client } = serverClient(async () => {
      throw new Error('upstream 502');
    });

    expect(await readSharedTopicFirstPage(client, 'share-x')).toEqual({
      firstPage: null,
      messageReadMode: 'forward',
    });
  });
});

describe('primeSharedTopicMessages forward', () => {
  afterEach(() => {
    delete window.__LOBE_SHARED_TOPIC_MESSAGES__;
  });

  it('hands the embedded first page to the forward list', async () => {
    const shared = topic();
    const firstPage = { messages: [{ id: 'u1' }] as any, newerCursor: null };

    primeSharedTopicMessages(shared, { firstPage, messageReadMode: 'forward' });

    await expect(
      takePrimedForwardMessagePage(toSharedConversationContext(shared, 'forward')),
    ).resolves.toEqual(firstPage);
  });

  it('marks the forward context so it reads apart from the newest-first list', () => {
    expect(toSharedConversationContext(topic(), 'forward')).toMatchObject({
      messageReadMode: 'forward',
    });
    expect(toSharedConversationContext(topic(), 'backward')).not.toHaveProperty('messageReadMode');
  });
});
