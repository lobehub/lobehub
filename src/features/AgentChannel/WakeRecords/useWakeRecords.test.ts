import { describe, expect, it, vi } from 'vitest';

import type { WakeDecisionPage } from '@/services/agentBotProvider';

import { withUserLabel } from './useWakeRecords';

vi.mock('@/services/agentBotProvider', () => ({ agentBotProviderService: {} }));

const item = (id: string, userLabel: any = null) =>
  ({ id, outcome: 'wake', userLabel }) as WakeDecisionPage['items'][number];

describe('withUserLabel', () => {
  const pages = [
    { items: [item('a'), item('b')], nextCursor: { createdAt: 'x', id: 'b' } },
    { items: [item('c', { label: 'correct' })] },
  ] as WakeDecisionPage[];

  it('sets the mark on the one decision across pages and leaves the rest', () => {
    const mark = { createdAt: new Date(), label: 'false_wake' as const, note: undefined };

    const next = withUserLabel(pages, 'c', mark)!;

    expect(next[1].items[0].userLabel).toBe(mark);
    expect(next[0].items.map((i) => i.userLabel)).toEqual([null, null]);
    expect(next[0].nextCursor).toEqual(pages[0].nextCursor);
  });

  it('puts the previous mark back on rollback', () => {
    const marked = withUserLabel(pages, 'c', null)!;

    expect(marked[1].items[0].userLabel).toBeNull();
    expect(pages[1].items[0].userLabel).toEqual({ label: 'correct' });
  });

  it('leaves an unloaded list alone', () => {
    expect(withUserLabel(undefined, 'a', null)).toBeUndefined();
  });
});
