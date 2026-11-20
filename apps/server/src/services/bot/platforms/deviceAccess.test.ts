import { describe, expect, it } from 'vitest';

import {
  extractDeviceAllowlist,
  extractDeviceChannelAllowlist,
  isDeviceChannelRestricted,
} from './deviceAccess';

describe('extractDeviceAllowlist', () => {
  it('returns the listed IDs under the allowlist policy', () => {
    expect(
      extractDeviceAllowlist({
        deviceAllowFrom: [{ id: ' u1 ', name: 'Ada' }, { id: '' }, { id: 'u2' }],
        devicePolicy: 'allowlist',
      }),
    ).toEqual(['u1', 'u2']);
  });

  it('ignores a kept list while the policy is owner only', () => {
    expect(
      extractDeviceAllowlist({ deviceAllowFrom: [{ id: 'u1' }], devicePolicy: 'owner' }),
    ).toEqual([]);
  });

  it('fails closed for missing or malformed settings', () => {
    expect(extractDeviceAllowlist(undefined)).toEqual([]);
    expect(extractDeviceAllowlist({ deviceAllowFrom: [{ id: 'u1' }] })).toEqual([]);
    expect(extractDeviceAllowlist({ deviceAllowFrom: 'u1', devicePolicy: 'everyone' })).toEqual([]);
  });
});

describe('extractDeviceChannelAllowlist', () => {
  it('returns the listed channel IDs under the allowlist policy', () => {
    expect(
      extractDeviceChannelAllowlist({
        deviceChannelAllowFrom: [{ id: ' c1 ', name: '#dev' }, { id: '' }, { id: 'c2' }],
        deviceChannelPolicy: 'allowlist',
      }),
    ).toEqual(['c1', 'c2']);
  });

  it('returns an empty list for an allowlist with no channels (restricts everywhere)', () => {
    expect(extractDeviceChannelAllowlist({ deviceChannelPolicy: 'allowlist' })).toEqual([]);
  });

  it('is unrestricted for missing, `any` or malformed policies', () => {
    expect(extractDeviceChannelAllowlist(undefined)).toBeUndefined();
    expect(
      extractDeviceChannelAllowlist({ deviceChannelAllowFrom: [{ id: 'c1' }] }),
    ).toBeUndefined();
    expect(
      extractDeviceChannelAllowlist({
        deviceChannelAllowFrom: [{ id: 'c1' }],
        deviceChannelPolicy: 'any',
      }),
    ).toBeUndefined();
    expect(extractDeviceChannelAllowlist({ deviceChannelPolicy: 'everywhere' })).toBeUndefined();
  });
});

describe('isDeviceChannelRestricted', () => {
  it('never restricts without a channel list', () => {
    expect(
      isDeviceChannelRestricted({
        candidateChannelIds: ['c9'],
        channelAllowlist: undefined,
        isDM: false,
      }),
    ).toBe(false);
  });

  it('never restricts a DM', () => {
    expect(
      isDeviceChannelRestricted({ candidateChannelIds: ['dm'], channelAllowlist: [], isDM: true }),
    ).toBe(false);
  });

  it('allows a listed channel, including through a parent-channel candidate', () => {
    expect(
      isDeviceChannelRestricted({
        candidateChannelIds: ['thread-1', 'c1'],
        channelAllowlist: ['c1'],
        isDM: false,
      }),
    ).toBe(false);
  });

  it('restricts unlisted channels, empty lists and unknown channels', () => {
    expect(
      isDeviceChannelRestricted({
        candidateChannelIds: ['c2'],
        channelAllowlist: ['c1'],
        isDM: false,
      }),
    ).toBe(true);
    expect(
      isDeviceChannelRestricted({ candidateChannelIds: ['c1'], channelAllowlist: [], isDM: false }),
    ).toBe(true);
    expect(
      isDeviceChannelRestricted({
        candidateChannelIds: [undefined, ''],
        channelAllowlist: ['c1'],
        isDM: false,
      }),
    ).toBe(true);
  });
});
