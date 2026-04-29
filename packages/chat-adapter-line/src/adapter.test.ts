import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLineAdapter,
  extractMediaMetadata,
  getMediaFileNameAndType,
  LineAdapter,
  resolveMediaMessageId,
} from './adapter';
import { computeSignature } from './api';
import type { LineMessageEvent, LineWebhookPayload } from './types';

const baseConfig = {
  channelAccessToken: 'token-test',
  channelSecret: 'secret-test',
  destinationUserId: 'Ubotbotbotbotbotbotbotbotbotbotbo',
};

function makeAdapter(overrides: Partial<typeof baseConfig> = {}) {
  const adapter = createLineAdapter({ ...baseConfig, ...overrides });
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
    getUserName: () => 'line-bot',
    processMessage,
  } as any;
  return { adapter, chat, processMessage };
}

function buildPayload(eventOverride: Partial<LineMessageEvent>): LineWebhookPayload {
  const event: LineMessageEvent = {
    message: { id: '1000', text: 'hi bot', type: 'text' },
    mode: 'active',
    source: { type: 'user', userId: 'U1234567890abcdef1234567890abcdef' },
    timestamp: 1_700_000_000_000,
    type: 'message',
    ...(eventOverride as object),
  } as LineMessageEvent;
  return {
    destination: baseConfig.destinationUserId,
    events: [event],
  };
}

function makeRequest(method: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/agent/webhooks/line/test', {
    body: method === 'GET' ? undefined : body,
    headers,
    method,
  });
}

describe('LineAdapter (signature verification)', () => {
  it('rejects POST with missing signature', async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.initialize(chat);

    const body = JSON.stringify(buildPayload({}));
    const res = await adapter.handleWebhook(makeRequest('POST', body));
    expect(res.status).toBe(401);
  });

  it('rejects POST with mismatched signature', async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.initialize(chat);

    const body = JSON.stringify(buildPayload({}));
    const res = await adapter.handleWebhook(
      makeRequest('POST', body, { 'x-line-signature': 'AAAA=' }),
    );
    expect(res.status).toBe(401);
  });

  it('accepts POST with valid signature and dispatches a message event', async () => {
    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const body = JSON.stringify(buildPayload({}));
    const sig = computeSignature(body, baseConfig.channelSecret);
    const res = await adapter.handleWebhook(makeRequest('POST', body, { 'x-line-signature': sig }));

    expect(res.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
    const [, threadId] = processMessage.mock.calls[0];
    expect(threadId).toBe('line:user:U1234567890abcdef1234567890abcdef');
  });

  it('returns 200 on the empty-events verification ping with a valid signature', async () => {
    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const body = JSON.stringify({ destination: baseConfig.destinationUserId, events: [] });
    const sig = computeSignature(body, baseConfig.channelSecret);
    const res = await adapter.handleWebhook(makeRequest('POST', body, { 'x-line-signature': sig }));

    expect(res.status).toBe(200);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('rejects non-POST verbs with 405', async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.initialize(chat);
    const res = await adapter.handleWebhook(makeRequest('GET', ''));
    expect(res.status).toBe(405);
  });
});

describe('LineAdapter (parsing)', () => {
  it('parses a 1:1 text message into a Message with the right thread id', async () => {
    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const body = JSON.stringify(
      buildPayload({
        message: { id: '4242', text: 'Hello bot', type: 'text' },
        timestamp: 1_700_001_234_000,
      }),
    );
    const sig = computeSignature(body, baseConfig.channelSecret);
    await adapter.handleWebhook(makeRequest('POST', body, { 'x-line-signature': sig }));

    const factory = processMessage.mock.calls[0][2] as () => Promise<any>;
    const message = await factory();
    expect(message.text).toBe('Hello bot');
    expect(message.id).toBe('4242');
    expect(message.threadId).toBe('line:user:U1234567890abcdef1234567890abcdef');
    expect(message.metadata.dateSent.getTime()).toBe(1_700_001_234_000);
  });

  it('encodes group + room thread ids using groupId / roomId', async () => {
    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const groupBody = JSON.stringify(
      buildPayload({
        source: {
          groupId: 'Cgroupgroupgroupgroupgroupgroupgr',
          type: 'group',
          userId: 'U1234567890abcdef1234567890abcdef',
        },
      }),
    );
    const groupSig = computeSignature(groupBody, baseConfig.channelSecret);
    await adapter.handleWebhook(makeRequest('POST', groupBody, { 'x-line-signature': groupSig }));
    expect(processMessage.mock.calls[0][1]).toBe('line:group:Cgroupgroupgroupgroupgroupgroupgr');

    processMessage.mockClear();

    const roomBody = JSON.stringify(
      buildPayload({
        source: {
          roomId: 'Rroomroomroomroomroomroomroomroom',
          type: 'room',
          userId: 'U1234567890abcdef1234567890abcdef',
        },
      }),
    );
    const roomSig = computeSignature(roomBody, baseConfig.channelSecret);
    await adapter.handleWebhook(makeRequest('POST', roomBody, { 'x-line-signature': roomSig }));
    expect(processMessage.mock.calls[0][1]).toBe('line:room:Rroomroomroomroomroomroomroomroom');
  });

  it('extracts metadata-only attachments for image/video/audio/file messages', () => {
    const image = extractMediaMetadata({ id: 'img-1', type: 'image' });
    expect(image).toHaveLength(1);
    expect(image[0].type).toBe('image');
    expect(image[0].mimeType).toBe('image/jpeg');
    expect((image[0] as any).raw.id).toBe('img-1');

    const file = extractMediaMetadata({
      fileName: 'spec.pdf',
      id: 'doc-1',
      type: 'file',
    });
    expect(file[0].type).toBe('file');
    expect(file[0].name).toBe('spec.pdf');

    expect(
      extractMediaMetadata({ id: 's-1', packageId: '1', stickerId: '1', type: 'sticker' }),
    ).toEqual([]);
  });

  it('resolveMediaMessageId returns the LINE message id only for downloadable kinds', () => {
    expect(resolveMediaMessageId({ id: 'img-1', type: 'image' })).toBe('img-1');
    expect(resolveMediaMessageId({ id: 'vid-1', type: 'video' })).toBe('vid-1');
    expect(resolveMediaMessageId({ id: 'au-1', type: 'audio' })).toBe('au-1');
    expect(resolveMediaMessageId({ id: 'f-1', type: 'file' })).toBe('f-1');
    expect(resolveMediaMessageId({ id: 'txt', text: 'hi', type: 'text' })).toBeUndefined();
    expect(getMediaFileNameAndType({ fileName: 'a.pdf', id: 'f-1', type: 'file' }).fileName).toBe(
      'a.pdf',
    );
  });
});

describe('LineAdapter (outbound)', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('postMessage hits /v2/bot/message/push with text payload', async () => {
    const adapter = new LineAdapter(baseConfig);
    await adapter.postMessage('line:user:U1234567890abcdef1234567890abcdef', 'hi back' as any);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-test');
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe('U1234567890abcdef1234567890abcdef');
    expect(body.messages).toEqual([{ text: 'hi back', type: 'text' }]);
  });

  it('startTyping uses loading API only for user threads', async () => {
    const adapter = new LineAdapter(baseConfig);
    await adapter.initialize({
      getLogger: () => ({
        child: () => ({}),
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      }),
      getUserName: () => 'line-bot',
      processMessage: vi.fn(),
    } as any);

    await adapter.startTyping('line:user:U1234567890abcdef1234567890abcdef');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.line.me/v2/bot/chat/loading/start');
    const body = JSON.parse(init.body as string);
    expect(body.chatId).toBe('U1234567890abcdef1234567890abcdef');

    fetchSpy.mockClear();
    await adapter.startTyping('line:group:Cgroupgroupgroupgroupgroupgroupgr');
    expect(fetchSpy).not.toHaveBeenCalled();

    await adapter.startTyping('line:room:Rroomroomroomroomroomroomroomroom');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
