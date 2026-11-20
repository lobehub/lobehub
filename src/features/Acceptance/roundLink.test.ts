import { describe, expect, it } from 'vitest';

import { buildAcceptanceRoundPath } from './roundLink';

describe('buildAcceptanceRoundPath', () => {
  it('deep-links a run in an acceptance to its round', () => {
    expect(buildAcceptanceRoundPath({ acceptanceId: 'acc-1', roundIndex: 2 })).toBe(
      '/acceptance/acc-1?r=2',
    );
  });

  it('has no destination for a run outside any acceptance', () => {
    expect(buildAcceptanceRoundPath({ acceptanceId: null, roundIndex: null })).toBeNull();
    expect(buildAcceptanceRoundPath({})).toBeNull();
    expect(buildAcceptanceRoundPath(null)).toBeNull();
    expect(buildAcceptanceRoundPath(undefined)).toBeNull();
  });

  it('opens the acceptance on its default view when the round is unknown', () => {
    expect(buildAcceptanceRoundPath({ acceptanceId: 'acc-1', roundIndex: null })).toBe(
      '/acceptance/acc-1',
    );
    expect(buildAcceptanceRoundPath({ acceptanceId: 'acc-1', roundIndex: 0 })).toBe(
      '/acceptance/acc-1',
    );
  });

  it('keeps the incoming query and replaces a stale round', () => {
    expect(
      buildAcceptanceRoundPath({ acceptanceId: 'acc-1', roundIndex: 3 }, '?hl=zh-CN&r=9'),
    ).toBe('/acceptance/acc-1?hl=zh-CN&r=3');
    expect(buildAcceptanceRoundPath({ acceptanceId: 'acc-1', roundIndex: null }, '?r=9')).toBe(
      '/acceptance/acc-1',
    );
  });

  it('encodes the acceptance id as one path segment', () => {
    expect(buildAcceptanceRoundPath({ acceptanceId: 'a/b', roundIndex: 1 })).toBe(
      '/acceptance/a%2Fb?r=1',
    );
  });
});
