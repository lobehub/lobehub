import { describe, expect, it } from 'vitest';

import { matchChannel } from './paths';

describe('matchChannel', () => {
  it.each([
    ['/channels/chn_1', 'chn_1'],
    ['/channels/chn_1/', 'chn_1'],
    ['/acme/channels/chn_1', 'chn_1'],
    ['/project/pro_1/channels/chn_1', 'chn_1'],
    ['/acme/project/pro_1/channels/chn_1/', 'chn_1'],
    ['/channels/chn_1/settings', 'chn_1'],
    ['/acme/project/pro_1/channels/chn_1/settings/', 'chn_1'],
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
