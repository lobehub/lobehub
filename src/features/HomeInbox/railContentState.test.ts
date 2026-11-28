import { describe, expect, it } from 'vitest';

import { resolveRailContentState } from './railContentState';

describe('resolveRailContentState', () => {
  it('reports a rail with any card as filled, even while another feed loads', () => {
    expect(resolveRailContentState({ feedsSettled: false, hasCards: true })).toBe('filled');
    expect(resolveRailContentState({ feedsSettled: true, hasCards: true })).toBe('filled');
  });

  it('keeps a rail without cards pending until its feeds answer', () => {
    expect(resolveRailContentState({ feedsSettled: false, hasCards: false })).toBe('pending');
  });

  it('reports the rail empty once its feeds answered with no card', () => {
    expect(resolveRailContentState({ feedsSettled: true, hasCards: false })).toBe('empty');
  });
});
