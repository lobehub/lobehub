import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCodeGatewayService } from './index';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  hasMembership: vi.fn(),
  resolveProvider: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  verifyClaudeCodeGatewayJwt: mocks.verifyToken,
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ findById: mocks.findById })),
}));

vi.mock('@/database/models/workspace', () => ({
  hasActiveWorkspaceMembership: mocks.hasMembership,
}));

vi.mock('./resolver', () => ({
  resolveClaudeCodeGatewayProvider: mocks.resolveProvider,
}));

describe('ClaudeCodeGatewayService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.verifyToken.mockResolvedValue({
      allowedModels: ['claude-sonnet'],
      deviceId: 'device-1',
      jti: 'jti-1',
      operationId: 'op-1',
      providerId: 'anthropic',
      userId: 'user-1',
    });
    mocks.findById.mockResolvedValue({
      metadata: {
        claudeCodeGateway: {
          allowedModels: ['claude-sonnet'],
          deviceId: 'device-1',
          providerId: 'anthropic',
          target: 'device',
        },
      },
      status: 'running',
    });
    mocks.hasMembership.mockResolvedValue(true);
    mocks.resolveProvider.mockResolvedValue({
      apiKey: 'provider-secret',
      baseURL: 'https://api.anthropic.com/v1/messages',
    });
  });

  it('passes Anthropic wire payloads and streaming responses through unchanged', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('event: message\ndata: {"type":"content_block_delta"}\n\n', {
        headers: { 'content-type': 'text/event-stream', 'request-id': 'req-1' },
        status: 200,
      }),
    );
    const payload = {
      max_tokens: 1024,
      messages: [{ content: 'hello', role: 'user' }],
      model: 'claude-sonnet',
      stream: true,
      thinking: { budget_tokens: 512, type: 'enabled' },
      tools: [{ input_schema: { type: 'object' }, name: 'read' }],
    };

    const response = await new ClaudeCodeGatewayService({} as never).handle(
      new Request('https://app.example.com/api/claude-code/v1/messages', {
        body: JSON.stringify(payload),
        headers: {
          'accept': 'text/event-stream',
          'anthropic-beta': 'prompt-caching-2024-07-31',
          'authorization': 'Bearer gateway-token',
          'cookie': 'must-not-forward=1',
          'x-forwarded-host': 'must-not-forward.example.com',
        },
        method: 'POST',
      }),
    );

    expect(await response.text()).toContain('content_block_delta');
    expect(response.headers.get('request-id')).toBe('req-1');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(init?.body as ArrayBuffer)))).toEqual(
      payload,
    );
    const headers = new Headers(init?.headers);
    expect(headers.get('x-api-key')).toBe('provider-secret');
    expect(headers.get('anthropic-beta')).toBe('prompt-caching-2024-07-31');
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('x-forwarded-host')).toBe(false);
  });

  it('rejects a model outside the operation snapshot before resolving credentials', async () => {
    const response = await new ClaudeCodeGatewayService({} as never).handle(
      new Request('https://app.example.com/api/claude-code/v1/messages', {
        body: JSON.stringify({ max_tokens: 1024, model: 'claude-opus' }),
        headers: { authorization: 'Bearer gateway-token' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
  });

  it('rejects an excessive output-token request before resolving credentials', async () => {
    const response = await new ClaudeCodeGatewayService({} as never).handle(
      new Request('https://app.example.com/api/claude-code/v1/messages', {
        body: JSON.stringify({ max_tokens: 128_001, model: 'claude-sonnet' }),
        headers: { authorization: 'Bearer gateway-token' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
  });

  it('rejects a token after its durable operation is interrupted', async () => {
    mocks.findById.mockResolvedValue({ status: 'interrupted' });
    const response = await new ClaudeCodeGatewayService({} as never).handle(
      new Request('https://app.example.com/api/claude-code/v1/messages', {
        body: JSON.stringify({ max_tokens: 1024, model: 'claude-sonnet' }),
        headers: { authorization: 'Bearer gateway-token' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
  });
});
