import { describe, expect, it, vi } from 'vitest';

import { computeSignature, createWhatsAppAdapter } from './adapter';
import type { WhatsAppWebhookPayload } from './types';

const baseConfig = {
  accessToken: 'token-test',
  appSecret: 'secret-test',
  phoneNumberId: '123456789012345',
  verifyToken: 'verify-test',
};

function makeRequest(method: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(
    `https://example.com/api/agent/webhooks/whatsapp/${baseConfig.phoneNumberId}`,
    {
      body: method === 'GET' ? undefined : body,
      headers,
      method,
    },
  );
}

async function makeAdapter() {
  const adapter = createWhatsAppAdapter(baseConfig);
  const messages: any[] = [];
  const processMessage = vi.fn(
    async (_adapter: unknown, _threadId: string, factory: () => Promise<unknown> | unknown) => {
      messages.push(await factory());
    },
  );
  const chat = {
    getLogger: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
    getUserName: () => 'whatsapp-bot',
    processMessage,
  } as any;

  await adapter.initialize(chat);
  return { adapter, messages, processMessage };
}

function buildPayload(): WhatsAppWebhookPayload {
  return {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              contacts: [{ profile: { name: 'Ada' }, wa_id: '15551234567' }],
              messaging_product: 'whatsapp',
              messages: [
                {
                  from: '15551234567',
                  id: 'wamid.abc',
                  text: { body: 'hello from whatsapp' },
                  timestamp: '1700000000',
                  type: 'text',
                },
              ],
              metadata: {
                display_phone_number: '15550001111',
                phone_number_id: baseConfig.phoneNumberId,
              },
            },
          },
        ],
        id: 'waba-1',
      },
    ],
    object: 'whatsapp_business_account',
  };
}

describe('WhatsAppAdapter', () => {
  it('returns hub.challenge for a valid GET verification request', async () => {
    const { adapter } = await makeAdapter();
    const res = await adapter.handleWebhook(
      new Request(
        `https://example.com/api/agent/webhooks/whatsapp/${baseConfig.phoneNumberId}?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=challenge-123`,
        { method: 'GET' },
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('challenge-123');
  });

  it('rejects GET verification with the wrong verify token', async () => {
    const { adapter } = await makeAdapter();
    const res = await adapter.handleWebhook(
      new Request(
        `https://example.com/api/agent/webhooks/whatsapp/${baseConfig.phoneNumberId}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123`,
        { method: 'GET' },
      ),
    );

    expect(res.status).toBe(401);
  });

  it('verifies POST signatures and dispatches inbound text messages', async () => {
    const { adapter, messages, processMessage } = await makeAdapter();
    const body = JSON.stringify(buildPayload());
    const res = await adapter.handleWebhook(
      makeRequest('POST', body, { 'x-hub-signature-256': computeSignature(body, 'secret-test') }),
    );

    expect(res.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(processMessage.mock.calls[0][1]).toBe('whatsapp:user:15551234567');
    expect(messages[0].text).toBe('hello from whatsapp');
    expect(messages[0].author.fullName).toBe('Ada');
    expect(messages[0].threadId).toBe('whatsapp:user:15551234567');
  });

  it('rejects POST requests with invalid signatures', async () => {
    const { adapter, processMessage } = await makeAdapter();
    const body = JSON.stringify(buildPayload());
    const res = await adapter.handleWebhook(
      makeRequest('POST', body, { 'x-hub-signature-256': 'sha256=bad' }),
    );

    expect(res.status).toBe(401);
    expect(processMessage).not.toHaveBeenCalled();
  });
});
