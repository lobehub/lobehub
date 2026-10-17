import { describe, expect, it } from 'vitest';

import { copyTabs, isCopyTab, resolveDetailTab } from './detailTabs';

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

describe('resolveDetailTab', () => {
  it('opens on Overview for a single copy, and on the Copies list for several', () => {
    expect(resolveDetailTab(undefined, 1)).toBe('overview');
    expect(resolveDetailTab(undefined, 2)).toBe('instances');
  });

  it('moves Overview to the Copies list once a second copy exists', () => {
    expect(resolveDetailTab('overview', 2)).toBe('instances');
  });

  it('moves the Copies list and its history back to Overview at one copy', () => {
    expect(resolveDetailTab('instances', 1)).toBe('overview');
    expect(resolveDetailTab('sessions', 1)).toBe('overview');
  });

  it('keeps a form tab whatever the copy count', () => {
    expect(resolveDetailTab('settings', 1)).toBe('settings');
    expect(resolveDetailTab('variables', 3)).toBe('variables');
  });
});
