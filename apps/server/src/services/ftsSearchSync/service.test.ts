// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FtsSearchSyncFailure,
  FtsSearchSyncWork,
} from '@/database/repositories/ftsSearchSyncOutbox';

import { ElasticsearchFtsSearchRequestError } from '../ftsSearch/elasticsearch';
import { FtsSearchSyncService } from './service';

const work = (documentId: string, revision: number = 1): FtsSearchSyncWork => ({
  documentId,
  entity: 'agents',
  leaseToken: `${revision}`,
  revision,
});

const createHarness = (
  works: FtsSearchSyncWork[],
  sources: Map<string, Record<string, unknown>>,
) => {
  const builder = {
    buildByIds: vi.fn(async (_entity: string, ids: readonly string[]) =>
      ids.flatMap((id) => {
        const source = sources.get(id);
        return source ? [{ entity: 'agents', id, source }] : [];
      }),
    ),
  };
  const outbox = {
    acknowledgeMany: vi.fn(async (items: FtsSearchSyncWork[]) => items),
    claim: vi.fn(async () => works),
    hasActionableWork: vi.fn(async () => false),
    hasDeadLetters: vi.fn(async () => false),
    markFailures: vi.fn(
      async (failures: FtsSearchSyncFailure[]) =>
        failures.filter((failure) => failure.permanent).length,
    ),
    releaseMany: vi.fn(async (_items: FtsSearchSyncWork[]) => undefined),
  };
  const client = { bulk: vi.fn() };

  return { builder, client, outbox };
};

describe('FtsSearchSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks durable dead-letter state without scanning or claiming work', async () => {
    const harness = createHarness([], new Map());
    harness.outbox.hasDeadLetters.mockResolvedValue(true);
    const service = new FtsSearchSyncService(
      harness.builder as never,
      harness.outbox as never,
      harness.client,
      'lobehub-test',
    );

    await expect(service.hasDeadLetters()).resolves.toBe(true);
    expect(harness.outbox.claim).not.toHaveBeenCalled();
  });

  it('settles each Elasticsearch bulk item independently', async () => {
    const works = [work('a'), work('b'), work('c'), work('d')];
    const harness = createHarness(
      works,
      new Map(works.map((item) => [item.documentId, { id: item.documentId, title: 'title' }])),
    );
    harness.client.bulk.mockResolvedValue({
      errors: true,
      items: [201, 409, 429, 400].map((status) => ({ index: { status } })),
    });
    const service = new FtsSearchSyncService(
      harness.builder as never,
      harness.outbox as never,
      harness.client,
      'lobehub-test',
      { bulkMaxBytes: 10_000 },
    );

    const result = await service.drainOnce();

    expect(harness.outbox.acknowledgeMany).toHaveBeenCalledWith([works[0], works[1]]);
    expect(harness.outbox.markFailures).toHaveBeenCalledWith([
      expect.objectContaining({ documentId: 'c' }),
      expect.objectContaining({ documentId: 'd' }),
    ]);
    expect(harness.outbox.markFailures.mock.calls[0][0]).toEqual([
      expect.not.objectContaining({ permanent: true }),
      expect.objectContaining({ permanent: true }),
    ]);
    expect(result).toMatchObject({
      acknowledged: 2,
      bulkBytes: expect.any(Number),
      bulkItems: 4,
      bulkRequestSamples: [
        expect.objectContaining({ bytes: expect.any(Number), items: 4, result: 'mixed' }),
      ],
      claimed: 4,
      dead: 1,
      failed: 2,
    });
    expect(result.bulkBytes).toBeGreaterThan(0);
  });

  it('writes a soft tombstone when the PostgreSQL row no longer exists', async () => {
    const harness = createHarness([work('deleted-agent', 7)], new Map());
    harness.client.bulk.mockResolvedValue({
      errors: false,
      items: [{ index: { status: 201 } }],
    });
    const service = new FtsSearchSyncService(
      harness.builder as never,
      harness.outbox as never,
      harness.client,
      'lobehub-test',
    );

    await service.drainOnce();

    expect(harness.client.bulk).toHaveBeenCalledWith(
      expect.stringContaining('{"id":"deleted-agent","fts_search_sync_deleted":true}'),
    );
    expect(harness.client.bulk.mock.calls[0][0]).toContain('"version":7,"version_type":"external"');
  });

  it('dead-letters one operation that exceeds the configured byte limit', async () => {
    const item = work('oversized');
    const following = work('following');
    const harness = createHarness(
      [item, following],
      new Map([
        ['oversized', { content: 'x'.repeat(1000), id: 'oversized' }],
        ['following', { id: 'following', title: 'later' }],
      ]),
    );
    const service = new FtsSearchSyncService(
      harness.builder as never,
      harness.outbox as never,
      harness.client,
      'lobehub-test',
      { bulkMaxBytes: 300 },
    );

    const result = await service.drainOnce();

    expect(harness.client.bulk).not.toHaveBeenCalled();
    expect(harness.outbox.markFailures).toHaveBeenCalledWith([
      expect.objectContaining({ documentId: 'oversized', permanent: true }),
    ]);
    expect(harness.outbox.releaseMany).toHaveBeenCalledWith([following]);
    expect(result.dead).toBe(1);
    expect(result.released).toBe(1);
  });

  it('stops after a split bulk creates a dead letter', async () => {
    const works = [work('a'), work('b'), work('c')];
    const harness = createHarness(
      works,
      new Map(works.map((item) => [item.documentId, { id: item.documentId, title: 'x' }])),
    );
    harness.client.bulk.mockResolvedValue({
      errors: true,
      items: [{ index: { status: 400 } }],
    });
    const service = new FtsSearchSyncService(
      harness.builder as never,
      harness.outbox as never,
      harness.client,
      'lobehub-test',
      { bulkMaxBytes: 210 },
    );

    const result = await service.drainOnce();

    expect(harness.client.bulk).toHaveBeenCalledTimes(1);
    expect(harness.outbox.releaseMany).toHaveBeenCalledWith([works[1], works[2]]);
    expect(result).toMatchObject({ dead: 1, failed: 1, released: 2 });
  });

  it.each([401, 403, 408, 413, 429, 503])(
    'durably retries a top-level HTTP %s failure',
    async (status) => {
      const item = work(`http-${status}`);
      const harness = createHarness(
        [item],
        new Map([[item.documentId, { id: item.documentId, title: 'title' }]]),
      );
      harness.client.bulk.mockRejectedValue(
        new ElasticsearchFtsSearchRequestError('bulk failed', status),
      );
      const service = new FtsSearchSyncService(
        harness.builder as never,
        harness.outbox as never,
        harness.client,
        'lobehub-test',
      );

      const result = await service.drainOnce();

      expect(harness.outbox.markFailures).toHaveBeenCalledWith([
        expect.objectContaining({ documentId: item.documentId }),
      ]);
      expect(harness.outbox.markFailures.mock.calls[0][0]).toEqual([
        expect.not.objectContaining({ permanent: true }),
      ]);
      expect(result.bulkRequestSamples).toEqual([
        expect.objectContaining({ items: 1, result: 'request_error' }),
      ]);
    },
  );

  it('preserves claimed priority order after grouping projection reads', async () => {
    const works: FtsSearchSyncWork[] = [
      { documentId: 'urgent-message', entity: 'messages', leaseToken: '2', revision: 2 },
      { documentId: 'ordinary-agent', entity: 'agents', leaseToken: '1', revision: 1 },
    ];
    const harness = createHarness(
      works,
      new Map(works.map((item) => [item.documentId, { id: item.documentId, title: 'title' }])),
    );
    harness.client.bulk.mockResolvedValue({
      errors: false,
      items: works.map(() => ({ index: { status: 201 } })),
    });
    const service = new FtsSearchSyncService(
      harness.builder as never,
      harness.outbox as never,
      harness.client,
      'lobehub-test',
    );

    await service.drainOnce();

    const body = harness.client.bulk.mock.calls[0][0] as string;
    const documentIds = body
      .trim()
      .split('\n')
      .filter((_, index) => index % 2 === 0)
      .map((line) => JSON.parse(line).index._id);
    expect(documentIds).toEqual(['urgent-message', 'ordinary-agent']);
  });

  it('releases unprocessed claims after exhausting the bulk-request budget', async () => {
    const works = [work('a'), work('b'), work('c')];
    const harness = createHarness(
      works,
      new Map(works.map((item) => [item.documentId, { id: item.documentId, title: 'x' }])),
    );
    harness.client.bulk.mockResolvedValue({
      errors: false,
      items: [{ index: { status: 201 } }],
    });
    let leasesReleased = false;
    harness.outbox.releaseMany.mockImplementationOnce(async () => {
      leasesReleased = true;
    });
    harness.outbox.hasActionableWork.mockImplementationOnce(async () => leasesReleased);
    const service = new FtsSearchSyncService(
      harness.builder as never,
      harness.outbox as never,
      harness.client,
      'lobehub-test',
      { bulkMaxBytes: 210, maxBulkRequests: 1 },
    );

    const result = await service.drainOnce();

    expect(harness.client.bulk).toHaveBeenCalledTimes(1);
    expect(harness.outbox.releaseMany).toHaveBeenCalledWith([works[1], works[2]]);
    expect(result).toMatchObject({ hasMore: true, released: 2 });
  });

  it('dead-letters an entity that the projection builder does not support', async () => {
    const item = { ...work('unknown'), entity: 'removedEntity' } as unknown as FtsSearchSyncWork;
    const supported = work('supported');
    const harness = createHarness(
      [item, supported],
      new Map([['supported', { id: 'supported', title: 'later' }]]),
    );
    const service = new FtsSearchSyncService(
      harness.builder as never,
      harness.outbox as never,
      harness.client,
      'lobehub-test',
    );

    await expect(service.drainOnce()).resolves.toMatchObject({ dead: 1, failed: 1 });
    expect(harness.builder.buildByIds).not.toHaveBeenCalled();
    expect(harness.outbox.markFailures).toHaveBeenCalledWith([
      expect.objectContaining({ documentId: 'unknown', permanent: true }),
    ]);
    expect(harness.outbox.releaseMany).toHaveBeenCalledWith([supported]);
  });

  it('stops when a projection failure exhausts its retry budget', async () => {
    const works = [work('a'), work('b')];
    const harness = createHarness(
      works,
      new Map(works.map((item) => [item.documentId, { id: item.documentId, title: 'x' }])),
    );
    harness.builder.buildByIds.mockRejectedValueOnce(new Error('projection unavailable'));
    harness.outbox.markFailures.mockResolvedValueOnce(1);
    const service = new FtsSearchSyncService(
      harness.builder as never,
      harness.outbox as never,
      harness.client,
      'lobehub-test',
      { projectionBatchSize: 1 },
    );

    const result = await service.drainOnce();

    expect(harness.builder.buildByIds).toHaveBeenCalledTimes(1);
    expect(harness.client.bulk).not.toHaveBeenCalled();
    expect(harness.outbox.releaseMany).toHaveBeenCalledWith([works[1]]);
    expect(result).toMatchObject({ dead: 1, failed: 1, released: 1 });
  });

  it('releases every unsettled lease when acknowledgement fails without hiding the main error', async () => {
    const works = [work('a'), work('b')];
    const harness = createHarness(
      works,
      new Map(works.map((item) => [item.documentId, { id: item.documentId, title: 'x' }])),
    );
    const acknowledgementError = new Error('acknowledgement unavailable');
    const releaseError = new Error('release unavailable');
    harness.client.bulk.mockResolvedValue({
      errors: false,
      items: works.map(() => ({ index: { status: 201 } })),
    });
    harness.outbox.acknowledgeMany.mockRejectedValueOnce(acknowledgementError);
    harness.outbox.releaseMany.mockRejectedValueOnce(releaseError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = new FtsSearchSyncService(
      harness.builder as never,
      harness.outbox as never,
      harness.client,
      'lobehub-test',
    );

    await expect(service.drainOnce()).rejects.toBe(acknowledgementError);

    expect(harness.outbox.releaseMany).toHaveBeenCalledWith(works);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to release unsettled full-text search sync leases',
      releaseError,
    );
    consoleError.mockRestore();
  });

  it('releases only failures still unsettled when failure settlement rejects', async () => {
    const works = [work('acknowledged'), work('failed')];
    const harness = createHarness(
      works,
      new Map(works.map((item) => [item.documentId, { id: item.documentId, title: 'x' }])),
    );
    const failureError = new Error('failure settlement unavailable');
    harness.client.bulk.mockResolvedValue({
      errors: true,
      items: [{ index: { status: 201 } }, { index: { status: 429 } }],
    });
    harness.outbox.markFailures.mockRejectedValueOnce(failureError);
    const service = new FtsSearchSyncService(
      harness.builder as never,
      harness.outbox as never,
      harness.client,
      'lobehub-test',
    );

    await expect(service.drainOnce()).rejects.toBe(failureError);

    expect(harness.outbox.acknowledgeMany).toHaveBeenCalledWith([works[0]]);
    expect(harness.outbox.releaseMany).toHaveBeenCalledWith([works[1]]);
  });
});
