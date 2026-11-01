import type { BotWakeDecisionPage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { withUserLabel } from './useWakeRecords';

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
