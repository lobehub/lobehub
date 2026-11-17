import { describe, expect, it } from 'vitest';

import { subSessionSelectors } from './selectors';

const state = (map: Record<string, any[]>) => ({ subSessionTreeMap: map }) as any;

describe('subSessionSelectors.hasSubSessions', () => {
  it('is true for a topic that opened a sub-session on screen', () => {
    const s = state({ 'tpc_a,tpc_b': [{ id: 'tpc_c', openedBy: { topicId: 'tpc_a' } }] });

    expect(subSessionSelectors.hasSubSessions('tpc_a')(s)).toBe(true);
    expect(subSessionSelectors.hasSubSessions('tpc_b')(s)).toBe(false);
    expect(subSessionSelectors.hasSubSessions(undefined)(s)).toBe(false);
  });
});
