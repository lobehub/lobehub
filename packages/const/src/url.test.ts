import { describe, expect, it } from 'vitest';

import { isOfficialCloudServer } from './url';

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
