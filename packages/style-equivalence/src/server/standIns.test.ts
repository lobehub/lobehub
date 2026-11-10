import { describe, expect, it } from 'vitest';

import { standInsFor } from './review';

describe('stand-ins shown on a review screenshot', () => {
  it('reads the stand-ins of a compared case from its plan', () => {
    expect(
      standInsFor('a.tsx|A#0', { plan: { file: 'a.tsx', standIns: { base: ['Tabs'] } } }, []),
    ).toEqual({
      base: ['Tabs'],
    });
  });

  it('reads the stand-ins of a one-sided element from the file plan', () => {
    const plans = [{ file: 'a.tsx', standIns: { 'head:A#1': ['Select'] } }];
    expect(standInsFor('a.tsx|unpaired:head:A#1', undefined, plans)).toEqual({ head: ['Select'] });
    expect(standInsFor('a.tsx|unpaired:base:A#1', undefined, plans)).toEqual({});
  });
});
