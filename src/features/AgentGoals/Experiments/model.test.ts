import { describe, expect, it } from 'vitest';

import { graphNodeLabel } from './model';

describe('graph node accessibility', () => {
  it.each(['问题', '结论', '决策'])(
    'names an unnumbered %s without a fabricated sequence',
    (kind) => {
      expect(graphNodeLabel(kind, '可复现的结论')).toBe(`${kind} · 可复现的结论`);
    },
  );
  it('preserves numbered experiment identity', () => {
    expect(graphNodeLabel('实验', '候选回答', 3)).toBe('实验 #3 · 候选回答');
  });
});
