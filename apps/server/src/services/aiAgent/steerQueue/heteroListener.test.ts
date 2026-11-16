import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HeteroSteerPollTracker,
  markHeteroSteerClosed,
  resolveHeteroWaitReasons,
} from './heteroListener';
import type { QueuedFollowUp } from './index';

const mocks = vi.hoisted(() => ({
  files: [] as { fileType: string; id: string }[],
  findTopic: vi.fn(),
  listeners: new Map<string, { ttlMs: number; value: string }>(),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: {
    steerQueue: {
      getHeteroListener: vi.fn(async (operationId: string) => {
        const raw = mocks.listeners.get(operationId);
        return raw ? JSON.parse(raw.value) : undefined;
      }),
      putHeteroListener: vi.fn(async (operationId: string, value: unknown, ttlMs: number) => {
        mocks.listeners.set(operationId, { ttlMs, value: JSON.stringify(value) });
      }),
    },
  },
}));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(function () {
    return {
      findByIds: vi.fn(async (ids: string[]) =>
        mocks.files.filter((file) => ids.includes(file.id)),
      ),
    };
  }),
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return { findById: mocks.findTopic };
  }),
}));

const log = { operationId: 'op-1', topicId: 'tpc-1' };
const listenerOf = (operationId = 'op-1') =>
  JSON.parse(mocks.listeners.get(operationId)?.value ?? 'null');

const entry = (id: string, request: Partial<QueuedFollowUp['request']> = {}) => ({
  id,
  request: { agentId: 'agt-1', prompt: `prompt ${id}`, ...request } as QueuedFollowUp['request'],
});
const ctx = { db: {} as any, userId: 'user-1', workspaceId: 'ws-1' };
const scope = { threadId: null, topicId: 'tpc-1', userId: 'user-1' };
const heteroMarker = (operationId = 'op-1') => ({
  metadata: { runningOperation: { heteroType: 'claude-code', operationId } },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.files = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('HeteroSteerPollTracker', () => {
  it('logs the run once when it starts taking follow-ups, not on every poll', async () => {
    await HeteroSteerPollTracker.start(log, { agentId: 'agt-1', cliVersion: '0.0.80' });
    await HeteroSteerPollTracker.start(log, { agentId: 'agt-1', cliVersion: '0.0.80' });

    expect(console.info).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.info).mock.calls[0].join(' ')).toContain(
      'op=op-1 topic=tpc-1 cli=0.0.80',
    );
    expect(listenerOf()).toMatchObject({ cliVersion: '0.0.80', state: 'listening' });
  });

  it('logs a held follow-up once per change and keeps it across polls', async () => {
    const first = await HeteroSteerPollTracker.start(log, { agentId: 'agt-1' });
    await first.hold({ entryId: 'a', reason: 'attachments' });
    await first.hold({ entryId: 'a', reason: 'attachments' });

    const next = await HeteroSteerPollTracker.start(log, { agentId: 'agt-1' });
    await next.hold({ entryId: 'a', reason: 'attachments' });

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(listenerOf().hold).toEqual({ entryId: 'a', reason: 'attachments' });

    await next.release();
    expect(listenerOf().hold).toBeUndefined();
  });

  it('starts listening again after the session closed', async () => {
    await markHeteroSteerClosed(log);
    expect(listenerOf()).toMatchObject({ state: 'closed' });

    await HeteroSteerPollTracker.start(log, { agentId: 'agt-1' });
    expect(listenerOf()).toMatchObject({ state: 'listening' });
    expect(console.info).toHaveBeenCalledTimes(1);
  });
});

describe('resolveHeteroWaitReasons', () => {
  it('says nothing behind a built-in run', async () => {
    mocks.findTopic.mockResolvedValue({ metadata: { runningOperation: { operationId: 'op-1' } } });

    const result = await resolveHeteroWaitReasons(ctx, scope, [entry('a')]);

    expect(result).toEqual({ listening: false, reasons: new Map() });
  });

  it('blames a CLI that never asked for follow-ups', async () => {
    mocks.findTopic.mockResolvedValue(heteroMarker());

    const result = await resolveHeteroWaitReasons(ctx, scope, [entry('a'), entry('b')]);

    expect(result.listening).toBe(false);
    expect([...result.reasons]).toEqual([
      ['a', 'notListening'],
      ['b', 'notListening'],
    ]);
  });

  it('blames a closed session', async () => {
    mocks.findTopic.mockResolvedValue(heteroMarker());
    await markHeteroSteerClosed(log);

    const result = await resolveHeteroWaitReasons(ctx, scope, [entry('a')]);

    expect(result.reasons.get('a')).toBe('inputClosed');
  });

  it('names each held follow-up and those queued behind it', async () => {
    mocks.findTopic.mockResolvedValue(heteroMarker());
    await HeteroSteerPollTracker.start(log, { agentId: 'agt-1' });

    const result = await resolveHeteroWaitReasons(ctx, scope, [
      entry('a'),
      entry('b', { fileIds: ['f1'] }),
      entry('c'),
    ]);

    expect(result.listening).toBe(true);
    expect([...result.reasons]).toEqual([
      ['b', 'attachments'],
      ['c', 'behindHeld'],
    ]);
  });

  it('lets image attachments through and holds documents', async () => {
    mocks.findTopic.mockResolvedValue(heteroMarker());
    mocks.files = [
      { fileType: 'image/png', id: 'img-1' },
      { fileType: 'application/pdf', id: 'doc-1' },
    ];
    await HeteroSteerPollTracker.start(log, {
      acceptsAttachedImages: true,
      acceptsImages: true,
      agentId: 'agt-1',
    });

    const result = await resolveHeteroWaitReasons(ctx, scope, [
      entry('a', { fileIds: ['img-1'] }),
      entry('b', { fileIds: ['img-1', 'doc-1'] }),
    ]);

    expect([...result.reasons]).toEqual([['b', 'attachments']]);
  });

  it('holds a follow-up queued with selections in the legacy shape, as delivery does', async () => {
    mocks.findTopic.mockResolvedValue(heteroMarker());
    await HeteroSteerPollTracker.start(log, { agentId: 'agt-1' });

    const result = await resolveHeteroWaitReasons(ctx, scope, [
      entry('a', { contextSelections: [{ content: 'quoted' }] } as any),
      entry('b'),
    ]);

    expect([...result.reasons]).toEqual([
      ['a', 'selection'],
      ['b', 'behindHeld'],
    ]);
  });

  it('finds the listener of a hetero child run on the main spine', async () => {
    mocks.findTopic.mockResolvedValue({
      metadata: {
        runningOperation: {
          childOperations: [{ heteroType: 'codex', operationId: 'op-child' }],
          operationId: 'op-root',
        },
      },
    });
    await HeteroSteerPollTracker.start(
      { operationId: 'op-child', topicId: 'tpc-1' },
      { agentId: 'agt-1' },
    );

    const result = await resolveHeteroWaitReasons(ctx, scope, [entry('a')]);

    expect(result).toEqual({ listening: true, reasons: new Map() });
  });

  it('asks nothing for a thread', async () => {
    const result = await resolveHeteroWaitReasons(ctx, { ...scope, threadId: 'thd-1' }, [
      entry('a'),
    ]);

    expect(result.listening).toBe(false);
    expect(mocks.findTopic).not.toHaveBeenCalled();
  });
});
