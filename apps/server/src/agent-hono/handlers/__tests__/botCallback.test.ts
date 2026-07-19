// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { botCallback } from '../botCallback';

const mockHandleCallback = vi.fn();

vi.mock('@/server/services/bot/BotCallbackService', () => ({
  BotCallbackService: vi.fn().mockImplementation(() => ({
    handleCallback: mockHandleCallback,
  })),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({} as any),
}));

function buildContext(opts: { body?: unknown; jsonThrows?: boolean }) {
  const captures: Array<{ body: any; status: number }> = [];
  const ctx = {
    json: (b: any, status = 200) => {
      captures.push({ body: b, status });
      return Response.json(b, { status });
    },
    req: {
      json: opts.jsonThrows
        ? async () => {
            throw new Error('bad json');
          }
        : async () => opts.body,
    },
  } as any;
  return { ctx, getCaptures: () => captures };
}

const validStepBody = {
  applicationId: 'app-1',
  platformThreadId: 'thread-1',
  progressMessageId: 'msg-1',
  type: 'step',
};

describe('botCallback handler', () => {
  beforeEach(() => {
    mockHandleCallback.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when JSON parsing throws', async () => {
    const { ctx } = buildContext({ jsonThrows: true });
    const res = await botCallback(ctx);
    expect(res.status).toBe(400);
    expect(mockHandleCallback).not.toHaveBeenCalled();
  });

  it.each([
    ['type', { ...validStepBody, type: undefined }],
    ['applicationId', { ...validStepBody, applicationId: undefined }],
    ['platformThreadId', { ...validStepBody, platformThreadId: undefined }],
  ])('returns 400 when required field %s is missing', async (_field, body) => {
    const { ctx, getCaptures } = buildContext({ body });
    const res = await botCallback(ctx);
    expect(res.status).toBe(400);
    expect(getCaptures()[0].body.error).toMatch(/Missing required fields/);
    expect(mockHandleCallback).not.toHaveBeenCalled();
  });

  it('returns 400 for unknown callback types', async () => {
    const { ctx, getCaptures } = buildContext({
      body: { ...validStepBody, type: 'unknown' },
    });
    const res = await botCallback(ctx);
    expect(res.status).toBe(400);
    expect(getCaptures()[0].body.error).toBe('Unknown callback type: unknown');
  });

  it('delegates to BotCallbackService and returns 200 on happy path', async () => {
    mockHandleCallback.mockResolvedValue(undefined);
    const { ctx, getCaptures } = buildContext({ body: validStepBody });

    const res = await botCallback(ctx);

    expect(res.status).toBe(200);
    expect(getCaptures()[0].body).toEqual({ success: true });
    expect(mockHandleCallback).toHaveBeenCalledWith(validStepBody);
  });

  it('accepts type=completion', async () => {
    mockHandleCallback.mockResolvedValue(undefined);
    const body = { ...validStepBody, type: 'completion' };
    const { ctx } = buildContext({ body });

    const res = await botCallback(ctx);
    expect(res.status).toBe(200);
    expect(mockHandleCallback).toHaveBeenCalledWith(body);
  });

  it('returns 500 with the error message when the service throws', async () => {
    mockHandleCallback.mockRejectedValue(new Error('service down'));
    const { ctx, getCaptures } = buildContext({ body: validStepBody });

    const res = await botCallback(ctx);

    expect(res.status).toBe(500);
    expect(getCaptures()[0].body).toEqual({ error: 'service down' });
  });
});
