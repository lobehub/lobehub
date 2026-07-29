// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { wechatWebhookGate } from './webhook';

const mockGatewayEnv = vi.hoisted(() => ({
  MESSAGE_GATEWAY_SERVICE_TOKEN: 'gateway-secret' as string | undefined,
}));

vi.mock('@/envs/gateway', () => ({
  gatewayEnv: mockGatewayEnv,
}));

const ctx = { invalidateBot: vi.fn() };

const buildRequest = (authorization?: string): Request =>
  new Request('https://app.example.com/api/agent/messenger/webhooks/wechat', {
    body: '{}',
    headers: authorization ? { authorization } : undefined,
    method: 'POST',
  });

beforeEach(() => {
  mockGatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN = 'gateway-secret';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('wechatWebhookGate.preprocess', () => {
  it('rejects requests without the Message Gateway bearer token', async () => {
    const response = await wechatWebhookGate.preprocess(buildRequest(), '{}', ctx);

    expect(response?.status).toBe(401);
  });

  it('rejects requests with an invalid Message Gateway bearer token', async () => {
    const response = await wechatWebhookGate.preprocess(
      buildRequest('Bearer wrong-secret'),
      '{}',
      ctx,
    );

    expect(response?.status).toBe(401);
  });

  it('fails closed when the Message Gateway service token is not configured', async () => {
    mockGatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN = undefined;

    const response = await wechatWebhookGate.preprocess(
      buildRequest('Bearer gateway-secret'),
      '{}',
      ctx,
    );

    expect(response?.status).toBe(503);
  });

  it('allows an authenticated Message Gateway request to continue', async () => {
    const response = await wechatWebhookGate.preprocess(
      buildRequest('Bearer gateway-secret'),
      '{}',
      ctx,
    );

    expect(response).toBeNull();
  });
});
