import { describe, expect, it } from 'vitest';

import {
  extractDeviceAllowlist,
  extractDeviceChannelAllowlist,
  extractDeviceChannelGrantlist,
  isDeviceChannelGranted,
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

describe('device channel grant', () => {
  const granted = {
    deviceChannelAllowFrom: [{ id: ' c1 ', name: '#dev' }, { id: '' }, { id: 'c2' }],
    deviceChannelPolicy: 'allowlist',
    devicePolicy: 'channel',
  };

  it('returns the listed channel IDs as the grant list under the channel policy', () => {
    expect(extractDeviceChannelGrantlist(granted)).toEqual(['c1', 'c2']);
  });

  it('has no grant list under any other policy', () => {
    expect(
      extractDeviceChannelGrantlist({ ...granted, devicePolicy: 'allowlist' }),
    ).toBeUndefined();
    expect(extractDeviceChannelGrantlist({ ...granted, devicePolicy: 'owner' })).toBeUndefined();
    expect(extractDeviceChannelGrantlist(undefined)).toBeUndefined();
  });

  it('turns off the channel restriction under the channel policy', () => {
    expect(extractDeviceChannelAllowlist(granted)).toBeUndefined();
  });

  it('grants a conversation in a listed channel, including a reply thread of it', () => {
    expect(
      isDeviceChannelGranted({
        candidateChannelIds: ['thread-1', 'c2'],
        channelGrantlist: ['c1', 'c2'],
        isDM: false,
      }),
    ).toBe(true);
  });

  it('does not grant other channels, DMs, an empty list or a missing list', () => {
    expect(
      isDeviceChannelGranted({
        candidateChannelIds: ['c3'],
        channelGrantlist: ['c1'],
        isDM: false,
      }),
    ).toBe(false);
    expect(
      isDeviceChannelGranted({ candidateChannelIds: ['c1'], channelGrantlist: ['c1'], isDM: true }),
    ).toBe(false);
    expect(
      isDeviceChannelGranted({ candidateChannelIds: ['c1'], channelGrantlist: [], isDM: false }),
    ).toBe(false);
    expect(
      isDeviceChannelGranted({
        candidateChannelIds: ['c1'],
        channelGrantlist: undefined,
        isDM: false,
      }),
    ).toBe(false);
  });
});
