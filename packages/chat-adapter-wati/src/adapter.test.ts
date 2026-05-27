import { describe, expect, it, vi } from 'vitest';

import { createWatiAdapter } from './adapter';
import { computeSignature } from './api';
import type { WatiInboundMessage } from './types';

const baseConfig = {
  apiBaseUrl: 'https://live-mt-server.wati.io',
  bearerToken: 'bearer-test',
  channelPhoneNumber: '85264318722',
  tenantId: 'tenant-test',
  webhookSecret: 'webhook-secret-test',
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

function makeRequest(method: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/agent/webhooks/wati/test', {
    body: method === 'GET' ? undefined : body,
    headers,
    method,
  });
}

describe('WatiAdapter (signature verification)', () => {
  it('rejects POST with missing signature when webhookSecret is set', async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.initialize(chat);

    const body = JSON.stringify(buildInbound());
    const res = await adapter.handleWebhook(makeRequest('POST', body));
    expect(res.status).toBe(401);
  });

  it('accepts POST with valid signature and dispatches customer messages', async () => {
    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const body = JSON.stringify(buildInbound());
    const sig = computeSignature(body, baseConfig.webhookSecret);
    const res = await adapter.handleWebhook(makeRequest('POST', body, { 'x-wati-signature': sig }));

    expect(res.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
    const [, threadId] = processMessage.mock.calls[0];
    expect(threadId).toBe('wati:user:85264318721');
  });

  it('skips business-originated messages (owner: true)', async () => {
    const { adapter, chat, processMessage } = makeAdapter();
    await adapter.initialize(chat);

    const body = JSON.stringify(buildInbound({ owner: true }));
    const sig = computeSignature(body, baseConfig.webhookSecret);
    const res = await adapter.handleWebhook(makeRequest('POST', body, { 'x-wati-signature': sig }));

    expect(res.status).toBe(200);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('allows unsigned webhooks when webhookSecret is omitted', async () => {
    const { adapter, chat, processMessage } = makeAdapter({ webhookSecret: undefined });
    await adapter.initialize(chat);

    const body = JSON.stringify(buildInbound());
    const res = await adapter.handleWebhook(makeRequest('POST', body));

    expect(res.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
  });
});

describe('WatiAdapter (parsing)', () => {
  it('parses inbound text into a Message', async () => {
    const { adapter, chat } = makeAdapter({ webhookSecret: undefined });
    await adapter.initialize(chat);

    const payload = buildInbound();
    const message = adapter.parseInbound(payload, 'wati:user:85264318721');

    expect(message.text).toBe('hello agent');
    expect(message.id).toBe('wamid.test123');
    expect(message.author.userId).toBe('85264318721');
  });
});
