// @vitest-environment node
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getServerDB: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));

const { clearDocumentRewriteWorkerConfiguration, configureDocumentRewriteWorker, documentRewrite } =
  await import('./documentRewrite');

describe('documentRewrite queue handler', () => {
  afterEach(() => {
    clearDocumentRewriteWorkerConfiguration();
    vi.clearAllMocks();
  });

  it('accepts the existing QueueService envelope but passes only the tiny message to the worker', async () => {
    mocks.getServerDB.mockResolvedValue({});
    const process = vi.fn(async (message: { attempt: number; requestId: string }) => ({
      attempt: message.attempt,
      requestId: message.requestId,
      status: 'awaiting_review' as const,
    }));
    configureDocumentRewriteWorker(() => ({ process }) as never);
    const app = new Hono();
    app.post('/', documentRewrite);

    const response = await app.request('/', {
      body: JSON.stringify({
        operationId: 'transport-operation',
        payload: {
          attempt: 2,
          requestId: 'request-1',
          ticket: 'must-not-reach-worker',
        },
        stepIndex: 2,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    // The nested application message is strict too; an injected ticket is
    // rejected before DB/worker access.
    expect(response.status).toBe(400);
    expect(process).not.toHaveBeenCalled();
  });

  it('delivers a valid nested message and returns the worker result', async () => {
    mocks.getServerDB.mockResolvedValue({});
    const process = vi.fn(async () => ({
      attempt: 1,
      requestId: 'request-1',
      status: 'awaiting_review' as const,
    }));
    configureDocumentRewriteWorker(() => ({ process }) as never);
    const app = new Hono();
    app.post('/', documentRewrite);

    const response = await app.request('/', {
      body: JSON.stringify({ payload: { attempt: 1, requestId: 'request-1' } }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requestId: 'request-1', success: true });
    expect(process).toHaveBeenCalledWith({ attempt: 1, requestId: 'request-1' });
  });
});
