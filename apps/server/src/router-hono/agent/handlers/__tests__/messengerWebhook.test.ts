// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { messengerWebhook } from '../messengerWebhook';

const { mockGetMessengerRouter, mockGetWebhookHandler } = vi.hoisted(() => {
  const getWebhookHandler = vi.fn();
  return {
    mockGetMessengerRouter: vi.fn(() => ({ getWebhookHandler })),
    mockGetWebhookHandler: getWebhookHandler,
  };
});

vi.mock('@/server/services/messenger', () => ({
  getMessengerRouter: mockGetMessengerRouter,
}));

describe('messengerWebhook handler', () => {
  it('passes a waitUntil option to the Messenger router', async () => {
    const rawRequest = new Request('http://x/api/agent/messenger/webhooks/telegram', {
      body: '{}',
      method: 'POST',
    });
    const response = new Response('ok');
    const handler = vi.fn().mockResolvedValue(response);
    mockGetWebhookHandler.mockReturnValue(handler);
    const context = {
      req: {
        param: (name: string) => (name === 'platform' ? 'telegram' : undefined),
        raw: rawRequest,
        url: rawRequest.url,
      },
    } as any;

    await expect(messengerWebhook(context)).resolves.toBe(response);
    expect(mockGetWebhookHandler).toHaveBeenCalledWith('telegram');
    expect(handler).toHaveBeenCalledWith(rawRequest, {
      waitUntil: expect.any(Function),
    });
  });
});
