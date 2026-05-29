import { describe, expect, it, vi } from 'vitest';

import { createWatiAdapter } from './adapter';
import { WatiApiClient } from './api';
import type { WatiInboundMessage } from './types';

const baseConfig = {
  apiBaseUrl: 'https://live-mt-server.wati.io',
  bearerToken: 'bearer-test',
  channelPhoneNumber: '85264318722',
  tenantId: 'tenant-test',
};

function makeAdapter(overrides: Partial<typeof baseConfig> = {}) {
  const adapter = createWatiAdapter({ ...baseConfig, ...overrides });
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
    getUserName: () => 'wati-bot',
    processMessage,
  } as any;
  return { adapter, chat, processMessage };
}

function buildInbound(overrides: Partial<WatiInboundMessage> = {}): WatiInboundMessage {
  return {
    channelPhoneNumber: baseConfig.channelPhoneNumber,
    eventType: 'message',
    id: 'msg-1',
    owner: false,
    text: 'hello agent',
    type: 'text',
    waId: '85264318721',
    whatsappMessageId: 'wamid.test123',
    ...overrides,
  };
}

function makeRequest(method: string, body: string): Request {
  return new Request('https://example.com/api/agent/webhooks/wati/test', {
    body: method === 'GET' ? undefined : body,
    method,
  });
}

describe('WatiAdapter (inbound webhooks)', () => {
  it('dispatches customer messages', async () => {
    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const body = JSON.stringify(buildInbound());
    const res = await adapter.handleWebhook(makeRequest('POST', body));

    expect(res.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
    const [, threadId] = processMessage.mock.calls[0];
    expect(threadId).toBe('wati:user:85264318721');
  });

  it('skips business-originated messages (owner: true)', async () => {
    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const body = JSON.stringify(buildInbound({ owner: true }));
    const res = await adapter.handleWebhook(makeRequest('POST', body));

    expect(res.status).toBe(200);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('ignores duplicate webhook deliveries for the same message id', async () => {
    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const body = JSON.stringify(
      buildInbound({ id: 'msg-dedupe-1', whatsappMessageId: 'wamid.dedupe-only' }),
    );

    const first = await adapter.handleWebhook(makeRequest('POST', body));
    const second = await adapter.handleWebhook(makeRequest('POST', body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
  });
});

describe('WatiAdapter (outbound)', () => {
  it('sends markdown postables as plain text (not empty)', async () => {
    const sendSpy = vi
      .spyOn(WatiApiClient.prototype, 'sendSessionMessage')
      .mockResolvedValue(undefined);

    const { adapter, chat } = makeAdapter();
    await adapter.initialize(chat);

    await adapter.postMessage('wati:user:85264318721', {
      markdown: '**你好**，而家係 *測試*。',
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, text] = sendSpy.mock.calls[0];
    expect(text).toContain('你好');
    expect(text).not.toContain('**');

    sendSpy.mockRestore();
  });
});

describe('WatiAdapter (parsing)', () => {
  it('parses inbound text into a Message', async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.initialize(chat);

    const payload = buildInbound();
    const message = adapter.parseInbound(payload, 'wati:user:85264318721');

    expect(message.text).toBe('hello agent');
    expect(message.id).toBe('wamid.test123');
    expect(message.author.userId).toBe('85264318721');
  });
});
