import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('@lobechat/database', () => ({
  BootstrapMetricsModel: vi.fn(() => ({
    create: mocks.create,
  })),
  serverDB: {},
}));

const makeRequest = (body: unknown, init?: { origin?: string }) => {
  const headers = new Headers({
    'content-type': 'text/plain',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'x-forwarded-for': '203.0.113.1',
    'x-vercel-ip-country': 'SG',
  });

  if (init?.origin) headers.set('origin', init.origin);

  return {
    headers,
    nextUrl: { origin: 'https://app.example.com' },
    text: async () => JSON.stringify(body),
  } as NextRequest;
};

const validPayload = {
  anonId: 'anon-1',
  appVersion: '1.0.0',
  cold: true,
  isLogin: false,
  platform: 'web',
  spans: [{ durMs: 10, name: 'bundle', startMs: 1 }],
  totalMs: 20,
};

describe('POST /api/ingest/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists a valid same-origin bootstrap payload', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(validPayload, { origin: 'https://app.example.com' }));

    expect(res.status).toBe(204);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        appVersion: '1.0.0',
        browser: 'Chrome',
        cold: true,
        country: 'SG',
        platform: 'web',
        spans: validPayload.spans,
        totalMs: 20,
      }),
    );
  });

  it('rejects cross-origin requests by default', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(validPayload, { origin: 'https://evil.example.com' }));

    expect(res.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...validPayload, platform: 'wearable' }));

    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
