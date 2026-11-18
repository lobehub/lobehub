// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { inboundWebhookWorkflowApp } from './index';

const mocks = vi.hoisted(() => ({
  db: { source: 'test-db' },
  getServerDB: vi.fn(),
  sweep: vi.fn(),
  verify: vi.fn(),
  wake: vi.fn(),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
vi.mock('@/server/services/inboundWebhook/sweep', () => ({ sweepInboundWebhooks: mocks.sweep }));
vi.mock('@/server/services/inboundWebhook/waker', () => ({ wakeInboundWebhook: mocks.wake }));
vi.mock('@/libs/qstash', () => ({ verifyQStashSignature: mocks.verify }));
vi.mock('@lobechat/observability-otel/modules/upstash-workflow', () => ({
  recordUpstashWorkflowEvent: vi.fn(),
}));

const ID = '9f1f6f30-0000-4000-8000-000000000001';
const post = (path: string, body?: unknown) =>
  inboundWebhookWorkflowApp.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'upstash-signature': 'signature' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue(true);
  mocks.getServerDB.mockResolvedValue(mocks.db);
  mocks.sweep.mockResolvedValue({ maintained: 2, scheduled: 1 });
  mocks.wake.mockResolvedValue({ outcome: 'processed', processed: 2 });
});

describe('inbound webhook workflow routes', () => {
  it.each(['/sweep', '/wake'])(
    'authenticates %s without relying on a parent workflow middleware',
    async (path) => {
      mocks.verify.mockResolvedValue(false);
      const response = await post(path, { id: ID });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Invalid signature' });
      expect(mocks.getServerDB).not.toHaveBeenCalled();
      expect(mocks.sweep).not.toHaveBeenCalled();
      expect(mocks.wake).not.toHaveBeenCalled();
    },
  );

  it('runs the sweep after authentication even when QStash supplies no body', async () => {
    const response = await post('/sweep');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ maintained: 2, scheduled: 1 });
    expect(mocks.sweep).toHaveBeenCalledOnce();
    expect(mocks.sweep).toHaveBeenCalledWith(mocks.db);
    expect(mocks.wake).not.toHaveBeenCalled();
  });

  it('preserves the authenticated body for a single webhook wake', async () => {
    const response = await post('/wake', { id: ID });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'processed', processed: 2 });
    expect(mocks.wake).toHaveBeenCalledOnce();
    expect(mocks.wake).toHaveBeenCalledWith(mocks.db, ID);
    expect(mocks.verify.mock.calls[0][1]).toBe(JSON.stringify({ id: ID }));
    expect(mocks.sweep).not.toHaveBeenCalled();
  });

  it('returns retryable 503 for a busy topic', async () => {
    mocks.wake.mockResolvedValue({ outcome: 'deferred' });
    const response = await post('/wake', { id: ID });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ outcome: 'deferred' });
  });

  it.each([{}, { id: 'not-a-uuid' }, null, []])(
    'rejects invalid wake payloads before reading the database: %j',
    async (payload) => {
      const response = await post('/wake', payload);
      expect(response.status).toBe(400);
      expect(mocks.getServerDB).not.toHaveBeenCalled();
      expect(mocks.wake).not.toHaveBeenCalled();
    },
  );

  it.each(['{', ''])('returns 400 for malformed or empty JSON: %j', async (body) => {
    const response = await inboundWebhookWorkflowApp.request('/wake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(response.status).toBe(400);
    expect(mocks.wake).not.toHaveBeenCalled();
  });
});
