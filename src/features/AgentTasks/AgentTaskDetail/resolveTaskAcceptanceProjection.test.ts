import { describe, expect, it } from 'vitest';

import { resolveTaskAcceptanceRequirement } from './resolveTaskAcceptanceProjection';

describe('resolveTaskAcceptanceProjection', () => {
  it('uses the Task-configured requirement before the aggregate snapshot', () => {
    expect(
      resolveTaskAcceptanceRequirement(' Current task goal ', 'Historical aggregate goal'),
    ).toBe('Current task goal');
    expect(resolveTaskAcceptanceRequirement(' ', ' Aggregate goal ')).toBe('Aggregate goal');
  });
});
