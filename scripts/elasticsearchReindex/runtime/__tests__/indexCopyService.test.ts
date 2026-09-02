// @vitest-environment node
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FTS_SEARCH_INDEX_ANALYSIS,
  getFtsSearchIndexAlias,
  getFtsSearchIndexMappings,
  getFtsSearchPhysicalIndexName,
} from '../../../../packages/database/src/repositories/ftsSearchDocument';
import type { FtsSearchIndexCopyElasticsearchClient } from '../indexCopyService';
import { FtsSearchIndexCopyError, FtsSearchIndexCopyService } from '../indexCopyService';

const createClient = (
  overrides: Partial<FtsSearchIndexCopyElasticsearchClient> = {},
): FtsSearchIndexCopyElasticsearchClient => ({
  count: vi.fn().mockResolvedValue(0),
  ensureIndex: vi.fn().mockResolvedValue(undefined),
  getTask: vi.fn().mockResolvedValue({
    completed: true,
    created: 0,
    deleted: 0,
    failures: [],
    noops: 0,
    total: 0,
    updated: 0,
    versionConflicts: 0,
  }),
  refresh: vi.fn().mockResolvedValue(undefined),
  startReindex: vi
    .fn()
    .mockImplementation(async (_source: string, destination: string) => `task-${destination}`),
  switchAliases: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('FtsSearchIndexCopyService', () => {
  it('refreshes the source index before starting _reindex so unrefreshed consumer writes are copied', async () => {
    const order: string[] = [];
    const client = createClient({
      refresh: vi.fn(async (index: string) => {
        order.push(`refresh:${index}`);
      }),
      startReindex: vi.fn(async (source: string, destination: string) => {
        order.push(`reindex:${source}->${destination}`);
        return `task-${destination}`;
      }),
    });
    const service = new FtsSearchIndexCopyService(client, {
      entities: ['agents'],
      pollIntervalMs: 0,
    });

    await service.run('test', 1, 2);

    expect(order).toEqual([
      'refresh:test-agents-v1',
      'reindex:test-agents-v1->test-agents-v2',
      'refresh:test-agents-v2',
    ]);
  });

  it('copies each entity into the next schema version and reports counts', async () => {
    const pendingTaskIds = new Set<string>();
    const getTask = vi.fn(async (taskId: string) => {
      const isAgents = taskId.includes('agents');
      if (!pendingTaskIds.has(taskId)) {
        pendingTaskIds.add(taskId);
        return {
          completed: false,
          created: 0,
          deleted: 0,
          failures: [],
          noops: 0,
          total: isAgents ? 10 : 13,
          updated: 0,
          versionConflicts: 0,
        };
      }
      return {
        completed: true,
        created: isAgents ? 3 : 7,
        deleted: 0,
        failures: [],
        // Every source document must be accounted for: created + updated + versionConflicts + noops + deleted === total.
        noops: isAgents ? 4 : 1,
        total: isAgents ? 10 : 13,
        updated: isAgents ? 2 : 4,
        versionConflicts: 1,
      };
    });
    const count = vi.fn(async (index: string) => {
      if (index === 'test-agents-v1' || index === 'test-agents-v2') return 12;
      if (index === 'test-messages-v1' || index === 'test-messages-v2') return 34;
      throw new Error(`unexpected count index ${index}`);
    });
    const client = createClient({ count, getTask });
    const events: unknown[] = [];
    const service = new FtsSearchIndexCopyService(client, {
      entities: ['agents', 'messages'],
      onProgress: (event) => {
        events.push(event);
      },
      pollIntervalMs: 0,
    });

    const result = await service.run('test', 1, 2);

    expect(client.ensureIndex).toHaveBeenCalledWith('test-agents-v2', {
      mappings: {
        ...getFtsSearchIndexMappings('agents'),
        _meta: { reindex_run_id: 'copy-v1-v2', schema_version: 2 },
      },
      settings: { analysis: FTS_SEARCH_INDEX_ANALYSIS },
    });
    expect(client.ensureIndex).toHaveBeenCalledWith('test-messages-v2', {
      mappings: {
        ...getFtsSearchIndexMappings('messages'),
        _meta: { reindex_run_id: 'copy-v1-v2', schema_version: 2 },
      },
      settings: { analysis: FTS_SEARCH_INDEX_ANALYSIS },
    });

    expect(client.startReindex).toHaveBeenCalledWith('test-agents-v1', 'test-agents-v2');
    expect(client.startReindex).toHaveBeenCalledWith('test-messages-v1', 'test-messages-v2');

    // One "not completed" call followed by one "completed" call per entity.
    expect(getTask).toHaveBeenCalledTimes(4);
    expect(client.refresh).toHaveBeenCalledWith('test-agents-v2');
    expect(client.refresh).toHaveBeenCalledWith('test-messages-v2');

    expect(events).toContainEqual({
      entity: 'agents',
      taskId: 'task-test-agents-v2',
      type: 'copy_started',
    });
    expect(events).toContainEqual({
      entity: 'messages',
      taskId: 'task-test-messages-v2',
      type: 'copy_started',
    });
    expect(events).toContainEqual({
      created: 3,
      entity: 'agents',
      sourceCount: 12,
      targetCount: 12,
      type: 'copy_completed',
      updated: 2,
      versionConflicts: 1,
    });
    expect(events).toContainEqual({
      created: 7,
      entity: 'messages',
      sourceCount: 34,
      targetCount: 34,
      type: 'copy_completed',
      updated: 4,
      versionConflicts: 1,
    });

    expect(result).toEqual({
      aliasesSwitched: false,
      entities: {
        agents: { sourceCount: 12, targetCount: 12, updated: 2, versionConflicts: 1 },
        messages: { sourceCount: 34, targetCount: 34, updated: 4, versionConflicts: 1 },
      },
    });
    expect(client.switchAliases).not.toHaveBeenCalled();
  });

  it('wraps a reported reindex task failure in FtsSearchIndexCopyError', async () => {
    const client = createClient({
      getTask: vi.fn().mockResolvedValue({
        completed: true,
        created: 0,
        deleted: 0,
        failures: [{ reason: 'boom' }],
        noops: 0,
        total: 1,
        updated: 0,
        versionConflicts: 0,
      }),
    });
    const service = new FtsSearchIndexCopyService(client, {
      entities: ['agents'],
      pollIntervalMs: 0,
    });

    const error = await service.run('test', 1, 2).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(FtsSearchIndexCopyError);
    expect(error).toMatchObject({ entity: 'agents', name: 'FtsSearchIndexCopyError' });
    expect((error as FtsSearchIndexCopyError).cause).toEqual(
      expect.objectContaining({ message: expect.stringContaining('reported 1 failures') }),
    );
  });

  it('wraps a canceled reindex task in FtsSearchIndexCopyError', async () => {
    const client = createClient({
      getTask: vi.fn().mockResolvedValue({
        canceled: 'by user request',
        completed: true,
        created: 0,
        deleted: 0,
        failures: [],
        noops: 0,
        total: 1,
        updated: 0,
        versionConflicts: 0,
      }),
    });
    const service = new FtsSearchIndexCopyService(client, {
      entities: ['agents'],
      pollIntervalMs: 0,
    });

    const error = await service.run('test', 1, 2).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(FtsSearchIndexCopyError);
    expect(error).toMatchObject({ entity: 'agents', name: 'FtsSearchIndexCopyError' });
    expect((error as FtsSearchIndexCopyError).cause).toEqual(
      expect.objectContaining({ message: expect.stringContaining('canceled') }),
    );
  });

  it('keeps user content out of the reported failure message', async () => {
    const client = createClient({
      getTask: vi.fn().mockResolvedValue({
        completed: true,
        created: 0,
        deleted: 0,
        failures: [
          {
            cause: {
              reason: "failed to parse field [content]. Preview of field's value: 'SECRET-NOTE'",
              type: 'document_parsing_exception',
            },
            id: 'doc-1',
            index: 'lobehub-messages-v2',
            status: 400,
          },
        ],
        noops: 0,
        total: 1,
        updated: 0,
        versionConflicts: 0,
      }),
    });
    const service = new FtsSearchIndexCopyService(client, {
      entities: ['messages'],
      pollIntervalMs: 0,
    });

    const error = await service.run('lobehub', 1, 2).catch((caught: unknown) => caught);
    const message = (error as Error & { cause?: Error }).cause?.message ?? '';
    expect(message).toContain('document_parsing_exception');
    expect(message).toContain('400');
    expect(message).not.toContain('SECRET-NOTE');
    expect(message).not.toContain('doc-1');
  });

  it('wraps a reindex task whose reported counters do not add up to the total', async () => {
    const client = createClient({
      getTask: vi.fn().mockResolvedValue({
        completed: true,
        created: 5,
        deleted: 0,
        failures: [],
        noops: 0,
        total: 10,
        updated: 0,
        versionConflicts: 0,
      }),
    });
    const service = new FtsSearchIndexCopyService(client, {
      entities: ['agents'],
      pollIntervalMs: 0,
    });

    const error = await service.run('test', 1, 2).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(FtsSearchIndexCopyError);
    expect((error as FtsSearchIndexCopyError).cause).toEqual(
      expect.objectContaining({ message: expect.stringContaining('processed 5 of 10') }),
    );
  });

  it('counts version conflicts toward the total when the task completes', async () => {
    const client = createClient({
      getTask: vi.fn().mockResolvedValue({
        completed: true,
        created: 3,
        deleted: 0,
        failures: [],
        noops: 0,
        total: 10,
        updated: 0,
        versionConflicts: 7,
      }),
    });
    const service = new FtsSearchIndexCopyService(client, {
      entities: ['agents'],
      pollIntervalMs: 0,
    });

    await expect(service.run('test', 1, 2)).resolves.toMatchObject({ aliasesSwitched: false });
  });

  it('calls assertAliasSwitchAllowed before switching aliases when requested', async () => {
    const order: string[] = [];
    const client = createClient({
      switchAliases: vi.fn(async () => {
        order.push('switch-aliases');
      }),
    });
    const assertAliasSwitchAllowed = vi.fn(async () => {
      order.push('assert-alias-switch-allowed');
    });
    const events: unknown[] = [];
    const service = new FtsSearchIndexCopyService(client, {
      assertAliasSwitchAllowed,
      onProgress: (event) => {
        events.push(event);
      },
      pollIntervalMs: 0,
      switchAliases: true,
    });

    const result = await service.run('test', 1, 2);

    expect(order).toEqual(['assert-alias-switch-allowed', 'switch-aliases']);
    expect(client.switchAliases).toHaveBeenCalledWith(
      FTS_SEARCH_DOCUMENT_ENTITIES.map((entity) => ({
        alias: getFtsSearchIndexAlias('test', entity),
        physicalIndex: getFtsSearchPhysicalIndexName('test', entity, 2),
      })),
    );
    expect(result.aliasesSwitched).toBe(true);
    expect(events).toContainEqual({ type: 'aliases_switched' });
  });

  it('does not switch aliases when assertAliasSwitchAllowed rejects', async () => {
    const client = createClient();
    const assertAliasSwitchAllowed = vi
      .fn()
      .mockRejectedValue(new Error('sync consumer is still draining the outbox'));
    const service = new FtsSearchIndexCopyService(client, {
      assertAliasSwitchAllowed,
      pollIntervalMs: 0,
      switchAliases: true,
    });

    await expect(service.run('test', 1, 2)).rejects.toThrow(
      'sync consumer is still draining the outbox',
    );
    expect(client.switchAliases).not.toHaveBeenCalled();
  });

  it('does not switch aliases when switchAliases is false', async () => {
    const client = createClient();
    const service = new FtsSearchIndexCopyService(client, {
      entities: ['agents'],
      pollIntervalMs: 0,
    });

    const result = await service.run('test', 1, 2);

    expect(client.switchAliases).not.toHaveBeenCalled();
    expect(result.aliasesSwitched).toBe(false);
  });

  it('rejects when fromVersion is not older than toVersion', async () => {
    const client = createClient();
    const service = new FtsSearchIndexCopyService(client, {
      entities: ['agents'],
      pollIntervalMs: 0,
    });

    await expect(service.run('test', 2, 2)).rejects.toThrow(
      'requires an older source schema version',
    );
    await expect(service.run('test', 3, 2)).rejects.toThrow(
      'requires an older source schema version',
    );
  });

  it('rejects an entity subset combined with switchAliases in the constructor', () => {
    const client = createClient();

    expect(
      () =>
        new FtsSearchIndexCopyService(client, {
          entities: ['agents'],
          switchAliases: true,
        }),
    ).toThrow('Alias switching requires every search entity');
  });
});
