import { describe, expect, it } from 'vitest';

import {
  resolveLatestTaskAcceptanceChecks,
  resolveTaskAcceptanceRequirement,
} from './resolveTaskAcceptanceProjection';

describe('resolveTaskAcceptanceProjection', () => {
  it('projects the cross-round union onto the latest plan', () => {
    const checks = [
      { id: 'current-1', title: 'Current one' },
      { id: 'historical', title: 'Historical' },
      { id: 'current-3', supersededIds: ['current-2'], title: 'Current successor' },
    ];

    expect(
      resolveLatestTaskAcceptanceChecks(checks, [
        { run: { plan: [{ id: 'historical' }] } },
        { run: { plan: [{ id: 'current-1' }, { id: 'current-2' }] } },
      ]),
    ).toEqual([checks[0], checks[2]]);
  });

  it('uses the Task-configured requirement before the aggregate snapshot', () => {
    expect(
      resolveTaskAcceptanceRequirement(' Current task goal ', 'Historical aggregate goal'),
    ).toBe('Current task goal');
    expect(resolveTaskAcceptanceRequirement(' ', ' Aggregate goal ')).toBe('Aggregate goal');
  });
});
