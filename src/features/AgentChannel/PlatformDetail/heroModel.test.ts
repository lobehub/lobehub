import { describe, expect, it } from 'vitest';

import { getSetupGuide } from '../quickSetup/guides';
import { findInviteLink, maskId } from './heroModel';

describe('maskId', () => {
  it('keeps short IDs and abbreviates long ones', () => {
    expect(maskId('cli_a8f2c91b')).toBe('cli_a8f2c91b');
    expect(maskId('1294857201938475610')).toBe('1294…5610');
    expect(maskId('  ')).toBe('');
    expect(maskId(undefined)).toBe('');
  });
});

describe('findInviteLink', () => {
  it('finds Discord’s invite link once the app ID is known', () => {
    const guide = getSetupGuide('discord', {
      appName: 'Lobe',
      applicationId: '1294857201938475610',
    });
    expect(findInviteLink(guide)?.href).toContain('1294857201938475610');
  });

  it('has none before the app ID, or on platforms without an invite step', () => {
    expect(findInviteLink(getSetupGuide('discord', { appName: 'Lobe' }))).toBeUndefined();
    expect(findInviteLink(getSetupGuide('feishu', { appName: 'Lobe' }))).toBeUndefined();
    expect(findInviteLink(undefined)).toBeUndefined();
  });
});
