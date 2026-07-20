import type { UIChatMessage, WorkSummaryItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getAllWorkSummaries, getWorkSummariesByRootOperationId } from './workSummaries';

const summary = (
  id: string,
  rootOperationId: string,
  createdAt: string,
  extra?: Partial<WorkSummaryItem>,
): WorkSummaryItem =>
  ({
    event: { createdAt: new Date(createdAt), rootOperationId } as any,
    id,
    ...extra,
  }) as WorkSummaryItem;

const message = (overrides: Partial<UIChatMessage>): UIChatMessage =>
  ({ id: 'msg', role: 'assistant', ...overrides }) as UIChatMessage;

describe('getWorkSummariesByRootOperationId', () => {
  it('resolves works by the anchor message metadata stamp', () => {
    const works = [summary('work-1', 'op-a', '2026-07-01T00:00:00.000Z')];
    const messages = [
      message({ id: 'm1', metadata: { work: { rootOperationId: 'op-a' } } as any, works }),
    ];

    expect(getWorkSummariesByRootOperationId(messages, 'op-a')).toEqual(works);
  });

  it('falls back to the work event rootOperationId when metadata is unstamped', () => {
    const works = [summary('work-1', 'op-b', '2026-07-01T00:00:00.000Z')];
    // No `metadata.work.rootOperationId` — the index must still key by the event.
    const messages = [message({ id: 'm1', works })];

    expect(getWorkSummariesByRootOperationId(messages, 'op-b')).toEqual(works);
  });

  it('returns an empty array for an unknown or nullish rootOperationId', () => {
    const messages = [
      message({
        id: 'm1',
        metadata: { work: { rootOperationId: 'op-a' } } as any,
        works: [summary('work-1', 'op-a', '2026-07-01T00:00:00.000Z')],
      }),
    ];

    expect(getWorkSummariesByRootOperationId(messages, 'op-missing')).toEqual([]);
    expect(getWorkSummariesByRootOperationId(messages, null)).toEqual([]);
    expect(getWorkSummariesByRootOperationId(messages, undefined)).toEqual([]);
  });

  it('memoizes the index per messages array identity', () => {
    const messages = [
      message({
        id: 'm1',
        metadata: { work: { rootOperationId: 'op-a' } } as any,
        works: [summary('work-1', 'op-a', '2026-07-01T00:00:00.000Z')],
      }),
    ];

    // Same reference in, same resolved array out (built once, cached).
    expect(getWorkSummariesByRootOperationId(messages, 'op-a')).toBe(
      getWorkSummariesByRootOperationId(messages, 'op-a'),
    );
  });
});

describe('getAllWorkSummaries', () => {
  it('flattens every message, deduping to the latest event per work id', () => {
    const older = summary('work-1', 'op-a', '2026-07-01T00:00:00.000Z');
    const newer = summary('work-1', 'op-a', '2026-07-03T00:00:00.000Z');
    const other = summary('work-2', 'op-b', '2026-07-02T00:00:00.000Z');
    const messages = [
      message({ id: 'm1', works: [older] }),
      message({ id: 'm2', works: [newer, other] }),
    ];

    const result = getAllWorkSummaries(messages);

    // work-1 collapses to its newest event; sorted newest-first.
    expect(result.map((w) => w.id)).toEqual(['work-1', 'work-2']);
    expect(result[0]).toBe(newer);
    expect(result[1]).toBe(other);
  });

  it('returns an empty array when no message carries works', () => {
    expect(getAllWorkSummaries([message({ id: 'm1' })])).toEqual([]);
  });

  it('memoizes per (messages identity, threadId) so an unchanged snapshot is not rebuilt', () => {
    const messages = [
      message({ id: 'm1', works: [summary('work-1', 'op-a', '2026-07-01T00:00:00.000Z')] }),
    ];

    // Same reference + same thread scope in -> same resolved array out (built once).
    expect(getAllWorkSummaries(messages)).toBe(getAllWorkSummaries(messages));
    // A different thread scope over the same array is a distinct cache entry.
    expect(getAllWorkSummaries(messages, 't1')).not.toBe(getAllWorkSummaries(messages));
  });

  it('scopes to the requested thread (main thread excludes threaded messages)', () => {
    const mainWork = summary('work-main', 'op-a', '2026-07-01T00:00:00.000Z');
    const threadWork = summary('work-thread', 'op-b', '2026-07-02T00:00:00.000Z');
    const messages = [
      message({ id: 'm1', works: [mainWork] }),
      message({ id: 'm2', threadId: 't1', works: [threadWork] } as Partial<UIChatMessage>),
    ];

    expect(getAllWorkSummaries(messages).map((w) => w.id)).toEqual(['work-main']);
    expect(getAllWorkSummaries(messages, 't1').map((w) => w.id)).toEqual(['work-thread']);
  });
});
