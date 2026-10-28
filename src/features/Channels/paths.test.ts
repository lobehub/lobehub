import { describe, expect, it } from 'vitest';

import { channelPath, matchChannel } from './paths';

describe('channelPath', () => {
  it('builds the channel and thread paths', () => {
    expect(channelPath('chn_1')).toBe('/channels/chn_1');
    expect(channelPath('chn_1', 'cht_1')).toBe('/channels/chn_1?thread=cht_1');
  });

  it('opens a project Channel inside its project', () => {
    expect(channelPath('chn_1', null, 'pro_1')).toBe('/project/pro_1/channels/chn_1');
    expect(channelPath('chn_1', 'cht_1', 'pro_1')).toBe(
      '/project/pro_1/channels/chn_1?thread=cht_1',
    );
  });
});

describe('matchChannel', () => {
  it.each([
    ['/channels/chn_1', 'chn_1'],
    ['/channels/chn_1/', 'chn_1'],
    ['/acme/channels/chn_1', 'chn_1'],
    ['/project/pro_1/channels/chn_1', 'chn_1'],
    ['/acme/project/pro_1/channels/chn_1/', 'chn_1'],
  ])('reads %s as an open Channel', (pathname, expected) => {
    expect(matchChannel(pathname)).toBe(expected);
  });

  it.each([
    '/',
    '/channels',
    '/group/grp_1',
    '/agent/agt_1/channels/telegram',
    '/project/pro_1/channels',
  ])('finds no Channel in %s', (pathname) => {
    expect(matchChannel(pathname)).toBeUndefined();
  });
});
