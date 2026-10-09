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

  it('uses the profile shape for the default tab', () => {
    expect(resolveSettingsSkeletonBody('/settings')).toEqual({ kind: 'profile' });
    expect(resolveSettingsSkeletonBody('/settings/profile')).toEqual({ kind: 'profile' });
  });
});
