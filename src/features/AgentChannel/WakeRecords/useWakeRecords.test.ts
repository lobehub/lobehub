import type { BotWakeDecisionPage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { pageLoadFailed, recordsEmpty, withUserLabel } from './useWakeRecords';

vi.mock('@/services/agentBotProvider', () => ({ agentBotProviderService: {} }));

const item = (id: string, userLabel: any = null) =>
  ({ id, outcome: 'wake', userLabel }) as BotWakeDecisionPage['items'][number];

describe('withUserLabel', () => {
  const page = {
    items: [item('a'), item('b', { label: 'correct' })],
    total: 42,
  } as BotWakeDecisionPage;

  it('sets the mark on the one decision and leaves the rest and the total', () => {
    const mark = { createdAt: new Date(), label: 'false_wake' as const, note: undefined };

    const next = withUserLabel(page, 'a', mark)!;

    expect(next.items[0].userLabel).toBe(mark);
    expect(next.items[1].userLabel).toEqual({ label: 'correct' });
    expect(next.total).toBe(42);
  });

  it('puts the previous mark back on rollback without touching the original', () => {
    const cleared = withUserLabel(page, 'b', null)!;

    expect(cleared.items[1].userLabel).toBeNull();
    expect(page.items[1].userLabel).toEqual({ label: 'correct' });
  });

  it('leaves an unloaded page alone', () => {
    expect(withUserLabel(undefined, 'a', null)).toBeUndefined();
  });
});

describe('pageLoadFailed', () => {
  const shown = { items: [], total: 42 };

  it('reports a failed page turn while the previous page is still shown', () => {
    expect(pageLoadFailed({ data: shown, error: new Error('boom'), isLoading: false })).toBe(true);
  });

  it('stays quiet while the page loads, when it loaded, and before anything loaded', () => {
    expect(pageLoadFailed({ data: shown, error: new Error('boom'), isLoading: true })).toBe(false);
    expect(pageLoadFailed({ data: shown, error: undefined, isLoading: false })).toBe(false);
    // The first load's failure is the boundary's full error state, not this inline one.
    expect(pageLoadFailed({ data: undefined, error: new Error('boom'), isLoading: false })).toBe(
      false,
    );
  });
});

describe('recordsEmpty', () => {
  it('is the empty state only when nothing matches and nothing failed', () => {
    expect(recordsEmpty({ error: undefined, total: 0 })).toBe(true);
    expect(recordsEmpty({ error: undefined, total: 3 })).toBe(false);
  });

  it('does not read a failed filter load over a kept empty page as "no records"', () => {
    expect(recordsEmpty({ error: new Error('boom'), total: 0 })).toBe(false);
  });
});
