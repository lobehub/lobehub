import { describe, expect, it } from 'vitest';

import type { DocumentHistoryListItem } from '@/server/routers/lambda/_schema/documentHistory';

import { createStore } from './HistoryItemsProvider';

const createHistoryItem = (
  id: string,
  savedAt: string,
  overrides: Partial<DocumentHistoryListItem> = {},
): DocumentHistoryListItem => ({
  id,
  isCurrent: false,
  savedAt,
  saveSource: 'autosave',
  ...overrides,
});

describe('HistoryItemsProvider store', () => {
  it('should reuse unchanged history item references across refreshes', () => {
    const store = createStore();
    const items = [
      createHistoryItem('history-1', '2026-04-16T08:00:00.000Z'),
      createHistoryItem('history-2', '2026-04-16T07:00:00.000Z', { saveSource: 'manual' }),
    ];

    store.getState().setHistoryItems(items);

    const previousItemsById = store.getState().itemsById;

    store.getState().setHistoryItems(items.map((item) => ({ ...item })));

    const nextItemsById = store.getState().itemsById;

    expect(nextItemsById).toBe(previousItemsById);
    expect(nextItemsById['history-1']).toBe(previousItemsById['history-1']);
    expect(nextItemsById['history-2']).toBe(previousItemsById['history-2']);
  });

  it('should replace only the changed history item reference', () => {
    const store = createStore();
    const items = [
      createHistoryItem('history-1', '2026-04-16T08:00:00.000Z'),
      createHistoryItem('history-2', '2026-04-16T07:00:00.000Z', { saveSource: 'manual' }),
    ];

    store.getState().setHistoryItems(items);

    const previousItemsById = store.getState().itemsById;

    store.getState().setHistoryItems([{ ...items[0], isCurrent: true }, { ...items[1] }]);

    const nextItemsById = store.getState().itemsById;

    expect(nextItemsById['history-1']).not.toBe(previousItemsById['history-1']);
    expect(nextItemsById['history-2']).toBe(previousItemsById['history-2']);
  });
});
