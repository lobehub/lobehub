import { describe, expect, it } from 'vitest';

import { copyTabs, isCopyTab } from './detailTabs';

describe('copyTabs', () => {
  it('folds a single copy into an Overview, with no Copies tab', () => {
    expect(copyTabs(1)).toEqual(['overview']);
  });

  it('gives an environment with no copy yet the Overview too', () => {
    expect(copyTabs(0)).toEqual(['overview']);
  });

  it('lists the copies, with their run history, once there is more than one', () => {
    expect(copyTabs(2)).toEqual(['instances', 'sessions']);
  });
});

describe('isCopyTab', () => {
  it('tells the copy tabs from the form sections', () => {
    expect(isCopyTab('overview')).toBe(true);
    expect(isCopyTab('instances')).toBe(true);
    expect(isCopyTab('settings')).toBe(false);
  });
});
