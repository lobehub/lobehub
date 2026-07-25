import { describe, expect, it } from 'vitest';

import { resolveTaskAcceptanceGoal } from './resolveTaskAcceptanceGoal';

describe('resolveTaskAcceptanceGoal', () => {
  it('uses the task instruction as the acceptance-generation goal', () => {
    expect(
      resolveTaskAcceptanceGoal({
        description: 'Short description',
        instruction: '  Deliver a 1500-word science-fiction story with a complete ending.  ',
        name: 'Write a story',
      }),
    ).toBe('Deliver a 1500-word science-fiction story with a complete ending.');
  });

  it('falls back to the description and then the task name', () => {
    expect(
      resolveTaskAcceptanceGoal({ description: '  Export a readable PDF. ', name: 'Export PDF' }),
    ).toBe('Export a readable PDF.');
    expect(resolveTaskAcceptanceGoal({ name: '  Export PDF  ' })).toBe('Export PDF');
  });

  it('returns an empty goal when the task has no usable content', () => {
    expect(resolveTaskAcceptanceGoal({ description: ' ', instruction: '', name: null })).toBe('');
  });
});
