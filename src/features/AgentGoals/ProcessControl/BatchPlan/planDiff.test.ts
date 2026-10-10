import { describe, expect, it } from 'vitest';

import { planDiff } from './planDiff';

describe('planDiff', () => {
  it('reads a revision as the previous plan unchanged plus its own section', () => {
    expect(planDiff('Step one\nStep two', 'Step one\nStep two\n\n### v2\nSeed first')).toEqual([
      { kind: 'same', text: 'Step one' },
      { kind: 'same', text: 'Step two' },
      { kind: 'added', text: '' },
      { kind: 'added', text: '### v2' },
      { kind: 'added', text: 'Seed first' },
    ]);
  });

  it('marks a line the new version dropped as removed', () => {
    expect(planDiff('Keep\nDrop', 'Keep')).toEqual([
      { kind: 'same', text: 'Keep' },
      { kind: 'removed', text: 'Drop' },
    ]);
  });
});
