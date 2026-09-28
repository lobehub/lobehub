import { describe, expect, it } from 'vitest';

import { peekGenerationClock, startGenerationClock } from './generationClock';

describe('generationClock', () => {
  it('keeps the first start time across remounts of the same call', () => {
    expect(startGenerationClock('call_a', 1000)).toBe(1000);
    expect(startGenerationClock('call_a', 5000)).toBe(1000);
    expect(peekGenerationClock('call_a')).toBe(1000);
  });

  it('does not invent a start time for a call it never saw generating', () => {
    expect(peekGenerationClock('call_from_history')).toBeUndefined();
  });

  it('ignores calls without an id', () => {
    expect(startGenerationClock(undefined)).toBeUndefined();
    expect(peekGenerationClock(undefined)).toBeUndefined();
  });
});
