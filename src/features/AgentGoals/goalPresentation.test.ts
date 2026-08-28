import { describe, expect, it } from 'vitest';

import { goalStatusKey } from './goalPresentation';

describe('goalStatusKey', () => {
  it('maps every lifecycle state to a list-vocabulary key', () => {
    expect(goalStatusKey('planning')).toBe('goalList.status.planning');
    expect(goalStatusKey('running')).toBe('goalList.status.running');
    expect(goalStatusKey('review')).toBe('goalList.status.review');
    expect(goalStatusKey('achieved')).toBe('goalList.status.achieved');
  });

  it('reads a failed goal as needing attention rather than as an error state', () => {
    expect(goalStatusKey('failed')).toBe('goalList.status.error');
  });
});
