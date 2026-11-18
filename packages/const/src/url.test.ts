import { describe, expect, it } from 'vitest';

import {
  CHANNEL_URL,
  FEEDBACK,
  GITHUB,
  GITHUB_ISSUES,
  isOfficialCloudServer,
  RELEASES_URL,
} from './url';

describe('isOfficialCloudServer', () => {
  it.each([
    'https://app.lobehub.com',
    'https://lobehub.com',
    'https://lobehub.com/workspace',
    'https://staging.app.lobehub.com/',
  ])('treats %s as official', (url) => {
    expect(isOfficialCloudServer(url)).toBe(true);
  });

  it.each([
    'https://lobehub.com.evil.example',
    'https://notlobehub.com',
    'https://my-lobehub.internal',
    'http://localhost:3210',
    'not a url',
    '',
    undefined,
  ])('treats %s as self-hosted', (url) => {
    expect(isOfficialCloudServer(url)).toBe(false);
  });
});

describe('GitHub links', () => {
  it('point to the lobehub repository', () => {
    expect(GITHUB).toBe('https://github.com/lobehub/lobehub');
    expect(GITHUB_ISSUES).toBe('https://github.com/lobehub/lobehub/issues/new/choose');
    expect(FEEDBACK).toBe('https://github.com/lobehub/lobehub/issues/new/choose');
    expect(RELEASES_URL).toBe('https://github.com/lobehub/lobehub/releases');
  });
});

describe('CHANNEL_URL', () => {
  it('builds the channel and thread paths', () => {
    expect(CHANNEL_URL('chn_1')).toBe('/channels/chn_1');
    expect(CHANNEL_URL('chn_1', 'cht_1')).toBe('/channels/chn_1/threads/cht_1');
  });

  it('opens a project Channel inside its project', () => {
    expect(CHANNEL_URL('chn_1', null, 'pro_1')).toBe('/project/pro_1/channels/chn_1');
    expect(CHANNEL_URL('chn_1', 'cht_1', 'pro_1')).toBe(
      '/project/pro_1/channels/chn_1/threads/cht_1',
    );
  });
});
