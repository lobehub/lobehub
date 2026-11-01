import { describe, expect, it } from 'vitest';

import { resolveSettingsSkeletonBody } from './Page';

describe('resolveSettingsSkeletonBody', () => {
  it('uses the platform detail shape for a messenger platform page', () => {
    expect(resolveSettingsSkeletonBody('/settings/messenger/discord')).toEqual({
      kind: 'messengerDetail',
      platform: 'discord',
    });
  });

  it('keeps the section shape for the messenger list and other tabs', () => {
    expect(resolveSettingsSkeletonBody('/settings/messenger')).toEqual({ kind: 'section' });
    expect(resolveSettingsSkeletonBody('/settings/common')).toEqual({ kind: 'section' });
  });

  it('uses a per-tab sections shape for tabs that are not plain forms', () => {
    for (const tab of ['billing', 'credits', 'plans', 'referral', 'usage']) {
      expect(resolveSettingsSkeletonBody(`/settings/${tab}`)).toEqual({ kind: 'sections', tab });
    }
  });

  it('ignores inherited object keys when looking up a tab shape', () => {
    expect(resolveSettingsSkeletonBody('/settings/toString')).toEqual({ kind: 'section' });
  });

  it('uses the profile shape for the default tab', () => {
    expect(resolveSettingsSkeletonBody('/settings')).toEqual({ kind: 'profile' });
    expect(resolveSettingsSkeletonBody('/settings/profile')).toEqual({ kind: 'profile' });
  });
});
