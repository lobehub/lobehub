import { describe, expect, it } from 'vitest';

import { channelBasePath, matchChannel, matchChannelThread } from './paths';

describe('matchChannel', () => {
  it.each([
    ['/channels/chn_1', 'chn_1'],
    ['/channels/chn_1/', 'chn_1'],
    ['/acme/channels/chn_1', 'chn_1'],
    ['/project/pro_1/channels/chn_1', 'chn_1'],
    ['/acme/project/pro_1/channels/chn_1/', 'chn_1'],
    ['/channels/chn_1/settings', 'chn_1'],
    ['/acme/project/pro_1/channels/chn_1/settings/', 'chn_1'],
    ['/channels/chn_1/threads/cht_1', 'chn_1'],
    ['/acme/project/pro_1/channels/chn_1/threads/cht_1/', 'chn_1'],
  ])('reads %s as an open Channel', (pathname, expected) => {
    expect(matchChannel(pathname)).toBe(expected);
  });

  it.each([
    '/',
    '/channels',
    '/group/grp_1',
    '/agent/agt_1/channels/telegram',
    '/project/pro_1/channels',
    '/channels/chn_1/threads',
  ])('finds no Channel in %s', (pathname) => {
    expect(matchChannel(pathname)).toBeUndefined();
  });
});

describe('matchChannelThread', () => {
  it.each([
    ['/channels/chn_1/threads/cht_1', 'cht_1'],
    ['/acme/project/pro_1/channels/chn_1/threads/cht_1/', 'cht_1'],
  ])('reads %s as a thread page', (pathname, expected) => {
    expect(matchChannelThread(pathname)).toBe(expected);
  });

  it.each(['/channels/chn_1', '/channels/chn_1/settings', '/channels/chn_1/threads'])(
    'finds no thread page in %s',
    (pathname) => {
      expect(matchChannelThread(pathname)).toBeUndefined();
    },
  );
});

describe('channelBasePath', () => {
  it.each([
    ['/channels/chn_1', '/channels/chn_1'],
    ['/channels/chn_1/threads/cht_1', '/channels/chn_1'],
    ['/acme/project/pro_1/channels/chn_1/threads/cht_1/', '/acme/project/pro_1/channels/chn_1'],
  ])('keeps the Channel page of %s', (pathname, expected) => {
    expect(channelBasePath(pathname)).toBe(expected);
  });
});
