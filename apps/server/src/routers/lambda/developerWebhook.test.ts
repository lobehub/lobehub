// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { developerWebhookRouter } from './developerWebhook';

const { mockService, mockServiceConstructor } = vi.hoisted(() => {
  const service = {
    create: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    listDeliveries: vi.fn(),
    redeliver: vi.fn(),
    rotateSecret: vi.fn(),
    test: vi.fn(),
    update: vi.fn(),
  };
  return {
    mockService: service,
    mockServiceConstructor: vi.fn(function () {
      return service;
    }),
  };
});

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  return { wsCompatProcedure: authedProcedure };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn(function (opts: any) {
    return opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/server/services/developerWebhook', async () => {
  class DeveloperWebhookError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { DeveloperWebhookError, DeveloperWebhookService: mockServiceConstructor };
});

const createCaller = (workspaceId: string | null = 'ws-1') =>
  developerWebhookRouter.createCaller({
    serverDB: {},
    userId: 'user-1',
    workspaceId,
  } as any);

const serviceError = async (code: string, message: string) => {
  const { DeveloperWebhookError } = await import('@/server/services/developerWebhook');
  return new DeveloperWebhookError(code as any, message);
};

describe('developerWebhookRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes the service to the caller and the active workspace', async () => {
    mockService.list.mockResolvedValue({ items: [], total: 0 });

    await createCaller().list();
    expect(mockServiceConstructor).toHaveBeenLastCalledWith({}, 'user-1', 'ws-1');
    expect(mockService.list).toHaveBeenCalledWith({ limit: 50, offset: 0 });

    await createCaller(null).list({ limit: 10, offset: 20 });
    expect(mockServiceConstructor).toHaveBeenLastCalledWith({}, 'user-1', null);
    expect(mockService.list).toHaveBeenLastCalledWith({ limit: 10, offset: 20 });
  });

  it('creates an endpoint and returns its secret once', async () => {
    mockService.create.mockResolvedValue({ id: 'whe_1', secret: 'whsec_abc' });

    const result = await createCaller().create({
      description: 'CI',
      events: ['run.completed', 'run.failed'],
      url: 'https://example.com/hook',
    });

    expect(result).toEqual({ id: 'whe_1', secret: 'whsec_abc' });
    expect(mockService.create).toHaveBeenCalledWith({
      description: 'CI',
      events: ['run.completed', 'run.failed'],
      url: 'https://example.com/hook',
    });
  });

  it('rejects a non-web URL, unknown events and an empty subscription', async () => {
    const caller = createCaller();

    await expect(
      caller.create({ events: ['run.completed'], url: 'ftp://example.com' }),
    ).rejects.toThrow();
    await expect(caller.create({ events: ['run.completed'], url: 'not a url' })).rejects.toThrow();
    await expect(
      caller.create({ events: ['run.exploded' as any], url: 'https://example.com' }),
    ).rejects.toThrow();
    await expect(caller.create({ events: [], url: 'https://example.com' })).rejects.toThrow();
    expect(mockService.create).not.toHaveBeenCalled();
  });

  it('passes partial updates through', async () => {
    mockService.update.mockResolvedValue({ enabled: false, id: 'whe_1' });

    await createCaller().update({ id: 'whe_1', value: { enabled: false } });

    expect(mockService.update).toHaveBeenCalledWith('whe_1', { enabled: false });
  });

  it('wraps rotate, test, deliveries and redeliver 1:1', async () => {
    const caller = createCaller();
    mockService.rotateSecret.mockResolvedValue({ id: 'whe_1', secret: 'whsec_new' });
    mockService.test.mockResolvedValue({ id: 'whd_1', responseStatus: 200 });
    mockService.listDeliveries.mockResolvedValue({ items: [], total: 0 });
    mockService.redeliver.mockResolvedValue({ id: 'whd_2', status: 'pending' });

    await expect(caller.rotateSecret({ id: 'whe_1' })).resolves.toMatchObject({
      secret: 'whsec_new',
    });
    await expect(caller.test({ id: 'whe_1' })).resolves.toMatchObject({ responseStatus: 200 });
    await caller.listDeliveries({ id: 'whe_1', limit: 20 });
    expect(mockService.listDeliveries).toHaveBeenCalledWith('whe_1', { limit: 20, offset: 0 });
    await caller.redeliver({ deliveryId: 'whd_1', id: 'whe_1' });
    expect(mockService.redeliver).toHaveBeenCalledWith('whe_1', 'whd_1');
  });

  it('maps not_found to NOT_FOUND and limit_reached to CONFLICT', async () => {
    mockService.delete.mockRejectedValue(await serviceError('not_found', 'Webhook not found'));
    await expect(createCaller().delete({ id: 'missing' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    mockService.create.mockRejectedValue(await serviceError('limit_reached', 'At most 20'));
    await expect(
      createCaller().create({ events: ['run.completed'], url: 'https://example.com' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('hides unexpected failures behind INTERNAL_SERVER_ERROR', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockService.test.mockRejectedValue(new Error('db down'));

    await expect(createCaller().test({ id: 'whe_1' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    consoleError.mockRestore();
  });
});
