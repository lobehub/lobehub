import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createImessageAdapter, extractAttachmentMetadata, ImessageAdapter } from './adapter';
import { BlueBubblesApiClient } from './api';
import type { BlueBubblesMessage, BlueBubblesWebhookEvent } from './types';

const baseConfig = {
  password: 'server-password',
  serverUrl: 'https://bluebubbles.example.com',
  webhookSecret: 'shared-secret',
};

function makeAdapter(overrides: Partial<typeof baseConfig> = {}) {
  const adapter = createImessageAdapter({ ...baseConfig, ...overrides });
  const processMessage = vi.fn(
    async (_adapter: unknown, _threadId: string, factory: () => Promise<unknown> | unknown) =>
      factory(),
  );
  const chat = {
    getLogger: () => ({
      child: () => ({}),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
    getUserName: () => 'imessage-bot',
    processMessage,
  } as any;
  return { adapter, chat, processMessage };
}

function makeRequest(body: BlueBubblesWebhookEvent, secret = baseConfig.webhookSecret): Request {
  return new Request(
    `https://lobehub.example.com/api/agent/webhooks/imessage/mac?secret=${secret}`,
    {
      body: JSON.stringify(body),
      method: 'POST',
    },
  );
}

function textMessage(overrides: Partial<BlueBubblesMessage> = {}): BlueBubblesMessage {
  return {
    chats: [{ guid: 'iMessage;-;chat-1', style: 45 }],
    dateCreated: 1_700_000_000_000,
    guid: 'msg-1',
    handle: { address: '+15551234567' },
    isFromMe: false,
    text: 'hello',
    ...overrides,
  };
}

describe('ImessageAdapter webhook handling', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it('rejects POST with a missing or mismatched secret', async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.initialize(chat);

    const res = await adapter.handleWebhook(
      makeRequest({ data: textMessage(), type: 'new-message' }, 'wrong'),
    );
    expect(res.status).toBe(401);
  });

  it('dispatches a BlueBubbles new-message webhook to the chat guid thread', async () => {
    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const res = await adapter.handleWebhook(
      makeRequest({ data: textMessage(), type: 'new-message' }),
    );

    expect(res.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(processMessage.mock.calls[0][1]).toBe('imessage:iMessage;-;chat-1');

    const factory = processMessage.mock.calls[0][2] as () => Promise<any>;
    const message = await factory();
    expect(message.text).toBe('hello');
    expect(message.author.userId).toBe('+15551234567');
    expect(message.metadata.dateSent.getTime()).toBe(1_700_000_000_000);
  });

  it('enriches webhook messages that do not carry chats', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: textMessage({ guid: 'msg-needs-enrichment', text: 'enriched' }),
        }),
        { status: 200 },
      ),
    );

    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const res = await adapter.handleWebhook(
      makeRequest({ data: { guid: 'msg-needs-enrichment', isFromMe: false }, type: 'new-message' }),
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://bluebubbles.example.com/api/v1/message/msg-needs-enrichment?password=server-password&with=chats%2Cattachments',
    );
    expect(processMessage.mock.calls[0][1]).toBe('imessage:iMessage;-;chat-1');
  });

  it('ignores messages sent by the hosted Mac account', async () => {
    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const res = await adapter.handleWebhook(
      makeRequest({ data: textMessage({ isFromMe: true }), type: 'new-message' }),
    );

    expect(res.status).toBe(200);
    expect(processMessage).not.toHaveBeenCalled();
  });
});

describe('ImessageAdapter parsing and outbound', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { guid: 'sent-1', text: 'hi back' } }), {
        status: 200,
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it('extracts metadata-only attachments from BlueBubbles messages', () => {
    const attachments = extractAttachmentMetadata(
      textMessage({
        attachments: [
          {
            guid: 'att-1',
            mimeType: 'image/png',
            totalBytes: 123,
            transferName: 'photo.png',
          },
        ],
      }),
    );

    expect(attachments).toHaveLength(1);
    expect(attachments[0].type).toBe('image');
    expect(attachments[0].mimeType).toBe('image/png');
    expect((attachments[0] as any).raw.guid).toBe('att-1');
  });

  it('postMessage sends text through BlueBubbles /message/text', async () => {
    const adapter = new ImessageAdapter(baseConfig);
    const result = await adapter.postMessage('imessage:iMessage;-;chat-1', 'hi back' as any);

    expect(result.id).toBe('sent-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://bluebubbles.example.com/api/v1/message/text?password=server-password',
    );
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.chatGuid).toBe('iMessage;-;chat-1');
    expect(body.message).toBe('hi back');
    expect(body.method).toBe('apple-script');
    expect(body.tempGuid).toBeTruthy();
  });

  it('BlueBubblesApiClient pings the authenticated API endpoint', async () => {
    const api = new BlueBubblesApiClient(baseConfig);
    await api.ping();

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://bluebubbles.example.com/api/v1/ping?password=server-password',
    );
  });

  it('applies the request timeout when fetching outbound attachment URLs', async () => {
    vi.useFakeTimers();

    fetchSpy.mockImplementationOnce(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Attachment fetch timed out', 'AbortError'));
          });
        }),
    );

    const api = new BlueBubblesApiClient({ ...baseConfig, requestTimeoutMs: 1000 });
    const sendPromise = api.sendAttachment('iMessage;-;chat-1', {
      fetchUrl: 'https://assets.example.com/photo.png',
      mimeType: 'image/png',
      name: 'photo.png',
    });
    const assertion = expect(sendPromise).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(1000);

    await assertion;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://assets.example.com/photo.png');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      signal: expect.any(AbortSignal),
    });
  });
});
