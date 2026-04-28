// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

// Mock dependencies before import usage
const mockPipelineExec = vi.fn().mockResolvedValue([]);
const mockExpire = vi.fn(() => ({ exec: mockPipelineExec }));
const mockLpush = vi.fn(() => ({ expire: mockExpire }));
const mockPipeline = vi.fn(() => ({ lpush: mockLpush }));

const mockRedisClient = {
  pipeline: mockPipeline,
} as any;

const appEnvMock = {
  AGENT_GATEWAY_SERVICE_TOKEN: 'test-token',
};

vi.mock('@/envs/app', () => ({
  get appEnv() {
    return appEnvMock;
  },
}));

let currentRedisClient: any = mockRedisClient;
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => currentRedisClient,
}));

function buildRequest(body: unknown, token?: string) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('https://test.com/api/agent/tool-result', {
    body: JSON.stringify(body),
    headers,
    method: 'POST',
  });
}

const validBody = {
  content: '{"ok":true}',
  success: true,
  toolCallId: 'call-abc',
};

describe('/api/agent/tool-result POST', () => {
  beforeEach(() => {
    currentRedisClient = mockRedisClient;
    appEnvMock.AGENT_GATEWAY_SERVICE_TOKEN = 'test-token';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 503 when AGENT_GATEWAY_SERVICE_TOKEN is not configured', async () => {
    appEnvMock.AGENT_GATEWAY_SERVICE_TOKEN = '';
    const response = await POST(buildRequest(validBody, 'test-token'));
    expect(response.status).toBe(503);
  });

  it('returns 401 when authorization header is missing or wrong', async () => {
    const response = await POST(buildRequest(validBody));
    expect(response.status).toBe(401);

    const response2 = await POST(buildRequest(validBody, 'wrong-token'));
    expect(response2.status).toBe(401);
  });

  it('returns 400 when body is invalid', async () => {
    const response = await POST(buildRequest({ toolCallId: 'x' }, 'test-token'));
    expect(response.status).toBe(400);
  });

  it('returns 503 when Redis is unavailable', async () => {
    currentRedisClient = null;
    const response = await POST(buildRequest(validBody, 'test-token'));
    expect(response.status).toBe(503);
  });

  it('LPUSHes the payload and sets TTL on happy path', async () => {
    const response = await POST(buildRequest(validBody, 'test-token'));
    expect(response.status).toBe(204);
    expect(mockLpush).toHaveBeenCalledWith(
      'tool_result:call-abc',
      expect.stringContaining('"toolCallId":"call-abc"'),
    );
    expect(mockExpire).toHaveBeenCalledWith('tool_result:call-abc', 120);
    expect(mockPipelineExec).toHaveBeenCalled();
  });

  it('returns 503 when Redis pipeline exec throws', async () => {
    mockPipelineExec.mockRejectedValueOnce(new Error('redis down'));
    const response = await POST(buildRequest(validBody, 'test-token'));
    expect(response.status).toBe(503);
  });
});
