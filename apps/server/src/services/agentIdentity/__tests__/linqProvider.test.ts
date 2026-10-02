import { signLinqWebhookPayload } from '@lobechat/agent-address-linq';
import type { AgentAccountRef } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLinqProvider } from '../providers/linq';

const SECRET = 'whsec_bGluZXNlY3JldA==';
const NOW = Date.parse('2026-10-02T00:00:00.000Z');
const TIMESTAMP = Math.floor(NOW / 1000);

const inboundBody = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    data: {
      chat: { id: 'chat_1' },
      id: 'msg_1',
      parts: [{ type: 'text', value: 'hello agent' }],
      sender_handle: { handle: '+15550001111' },
      sent_at: '2026-10-02T00:00:00.000Z',
      ...overrides,
    },
    event_type: 'message.received',
  });

const signed = (body: string, id = 'delivery_1') => ({
  headers: {
    'webhook-id': id,
    'webhook-signature': signLinqWebhookPayload({ body, id, secret: SECRET, timestamp: TIMESTAMP }),
    'webhook-timestamp': String(TIMESTAMP),
  },
});

const ref = (overrides: Partial<AgentAccountRef> = {}): AgentAccountRef => ({
  credential: { webhookSecret: SECRET },
  id: 'acc_1',
  identifier: '+15550002222',
  kind: 'phone',
  metadata: { number: '+15550002222' },
  provider: 'linq',
  ...overrides,
});

describe('linq provider — declaration', () => {
  it('declares the phone identity it issues and what it can do', () => {
    const provider = createLinqProvider({ apiKey: 'linq_test' });

    expect(provider.provider).toBe('linq');
    expect(provider.kind).toBe('phone');
    expect(provider.capabilities).toEqual({ receive: true, send: true });
  });

  it('refuses to provision without an operator-provisioned number', async () => {
    const provider = createLinqProvider({ apiKey: 'linq_test' });

    await expect(provider.provision({ agentId: 'agent_7', userId: 'user_1' })).rejects.toThrow(
      /operator-provisioned number/,
    );
  });

  it('binds the configured number when one is available', async () => {
    const provider = createLinqProvider({ apiKey: 'linq_test', fromNumber: '+15550002222' });

    await expect(provider.provision({ agentId: 'agent_7', userId: 'user_1' })).resolves.toEqual({
      identifier: '+15550002222',
      metadata: { number: '+15550002222' },
    });
  });
});

describe('linq provider — inbound', () => {
  it('routes by the addressed number, falling back to the configured one', () => {
    const withRecipient = createLinqProvider({ apiKey: 'linq_test' });
    expect(
      withRecipient.resolveInboundIdentifier({
        body: inboundBody({ to: '+15550002222' }),
        headers: {},
      }),
    ).toBe('+15550002222');

    const fallback = createLinqProvider({ apiKey: 'linq_test', fromNumber: '+15550003333' });
    expect(fallback.resolveInboundIdentifier({ body: inboundBody(), headers: {} })).toBe(
      '+15550003333',
    );
  });

  it('accepts a correctly signed delivery and rejects a forged one', async () => {
    const provider = createLinqProvider({ apiKey: 'linq_test', now: () => NOW });
    const body = inboundBody();

    await expect(
      provider.verifyInbound({ body, headers: signed(body).headers }, ref()),
    ).resolves.toEqual({
      eventId: 'delivery_1',
      payload: expect.objectContaining({ event_type: 'message.received' }),
    });

    await expect(
      provider.verifyInbound(
        { body, headers: { ...signed(body).headers, 'webhook-signature': 'v1,AAAA' } },
        ref(),
      ),
    ).resolves.toBeNull();
  });

  it('rejects a replayed delivery instead of producing a second message', async () => {
    const provider = createLinqProvider({ apiKey: 'linq_test', now: () => NOW });
    const body = inboundBody();
    const headers = signed(body).headers;

    await expect(provider.verifyInbound({ body, headers }, ref())).resolves.toEqual(
      expect.objectContaining({ eventId: 'delivery_1' }),
    );
    await expect(provider.verifyInbound({ body, headers }, ref())).resolves.toBeNull();
  });

  it('normalizes text and media parts into the transport-neutral message', async () => {
    const provider = createLinqProvider({ apiKey: 'linq_test', now: () => NOW });

    const message = await provider.normalizeInbound(
      {
        eventId: 'delivery_1',
        payload: JSON.parse(
          inboundBody({
            parts: [
              { type: 'text', value: 'look at this' },
              { type: 'media', url: 'https://cdn.linq.test/a.png' },
            ],
          }),
        ),
      },
      ref(),
    );

    expect(message).toMatchObject({
      from: '+15550001111',
      providerMessageId: 'msg_1',
      threadKey: 'chat_1',
      to: '+15550002222',
    });
    expect(message!.text).toBe('look at this');
    expect(message!.attachments).toEqual([
      { mimeType: 'application/octet-stream', url: 'https://cdn.linq.test/a.png' },
    ]);
  });

  it('drops a delivery with no text', async () => {
    const provider = createLinqProvider({ apiKey: 'linq_test', now: () => NOW });

    const message = await provider.normalizeInbound(
      { eventId: 'delivery_1', payload: JSON.parse(inboundBody({ parts: [] })) },
      ref(),
    );

    expect(message).toBeNull();
  });
});

describe('linq provider — outbound', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends into the existing chat and degrades markdown to plain text', async () => {
    const calls: Array<{ body?: unknown; method: string; url: string }> = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined, method, url });

      if (new URL(url).pathname === '/v3/chats') {
        return new Response(JSON.stringify({ chats: [{ id: 'chat_1' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ chat_id: 'chat_1', message: { id: 'msg_out_1' } }), {
        status: 200,
      });
    }) as typeof fetch);

    const provider = createLinqProvider({ apiKey: 'linq_test', fromNumber: '+15550002222' });
    const result = await provider.send(ref(), {
      text: '**bold** and [link](https://x.test)',
      to: '+15550001111',
    });

    expect(result).toEqual({ providerMessageId: 'msg_out_1' });
    const send = calls.find((c) => c.method === 'POST');
    expect((send!.body as any).message.parts[0].value).toBe('bold and link (https://x.test)');
  });
});
