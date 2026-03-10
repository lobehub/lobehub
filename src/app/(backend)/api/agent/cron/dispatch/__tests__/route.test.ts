// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '../route';

const mockGetServerDB = vi.fn();
const mockDispatch = vi.fn();
const MockAgentCronDispatcher = vi.fn();

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: (...args: unknown[]) => mockGetServerDB(...args),
}));

vi.mock('@/server/services/agentCronDispatcher', () => ({
  AgentCronDispatcher: function (...args: unknown[]) {
    return MockAgentCronDispatcher(...args);
  },
}));

describe('/api/agent/cron/dispatch route', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    delete process.env.AGENT_CRON_DISPATCH_API_KEY;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;

    mockGetServerDB.mockResolvedValue({});
    MockAgentCronDispatcher.mockReturnValue({
      dispatch: mockDispatch,
    });
    mockDispatch.mockResolvedValue({
      dryRun: false,
      jobs: [],
      stats: {
        durationMs: 12,
        eligible: 0,
        failed: 0,
        scanned: 0,
        skipped: 0,
        triggered: 0,
      },
      tickAt: '2026-02-27T00:00:00.000Z',
    });
  });

  afterEach(() => {
    delete process.env.AGENT_CRON_DISPATCH_API_KEY;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
  });

  it('should return 401 when no auth is provided', async () => {
    const request = new NextRequest('https://test.com/api/agent/cron/dispatch', {
      body: '{}',
      method: 'POST',
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it('should return 400 for invalid request body', async () => {
    process.env.AGENT_CRON_DISPATCH_API_KEY = 'test-key';

    const request = new NextRequest('https://test.com/api/agent/cron/dispatch', {
      body: '{invalid',
      headers: { Authorization: 'Bearer test-key' },
      method: 'POST',
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('should dispatch with api key auth', async () => {
    process.env.AGENT_CRON_DISPATCH_API_KEY = 'test-key';

    const request = new NextRequest('https://test.com/api/agent/cron/dispatch', {
      body: JSON.stringify({
        dryRun: true,
        maxJobsPerTick: 20,
        now: '2026-02-27T00:30:00.000Z',
      }),
      headers: {
        'Authorization': 'Bearer test-key',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(MockAgentCronDispatcher).toHaveBeenCalledWith({}, { maxJobsPerTick: 20 });
    expect(mockDispatch).toHaveBeenCalledWith({
      dryRun: true,
      now: new Date('2026-02-27T00:30:00.000Z'),
    });
    expect(body.executionTime).toEqual(expect.any(Number));
  });

  it('should expose health and auth configuration in GET', async () => {
    process.env.AGENT_CRON_DISPATCH_API_KEY = 'test-key';
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'qstash-current';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'qstash-next';

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.healthy).toBe(true);
    expect(body.auth).toEqual({
      apiKey: true,
      qstashSignature: true,
    });
  });
});
