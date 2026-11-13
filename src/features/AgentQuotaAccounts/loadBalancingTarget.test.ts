import { describe, expect, it } from 'vitest';

import { balancesAccountsOn } from './loadBalancingTarget';

describe('balancesAccountsOn', () => {
  it('balances runs spawned on this desktop or on a bound device', () => {
    expect(balancesAccountsOn('local')).toBe(true);
    expect(balancesAccountsOn('device', 'dev-1')).toBe(true);
  });

  // Regression: a sandbox profile on Desktop saved a Manual pick for this
  // desktop's device, which sandbox runs never read.
  it('does not offer balancing where no run would honor a choice', () => {
    expect(balancesAccountsOn('sandbox')).toBe(false);
    expect(balancesAccountsOn('auto')).toBe(false);
    expect(balancesAccountsOn('none')).toBe(false);
    expect(balancesAccountsOn('device')).toBe(false);
  });
});
