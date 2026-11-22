import { describe, expect, it } from 'vitest';

import { goalResultStatusKey } from './goalResults';

describe('goalResultStatusKey', () => {
  it('maps failed goals to the localized needs-attention label', () => {
    expect(goalResultStatusKey('failed')).toBe('goalList.status.error');
  });

  it('uses the goal list vocabulary for other statuses', () => {
    expect(goalResultStatusKey('running')).toBe('goalList.status.running');
  });

  it('returns undefined for an unknown status', () => {
    expect(goalResultStatusKey('mystery')).toBeUndefined();
  });
});
