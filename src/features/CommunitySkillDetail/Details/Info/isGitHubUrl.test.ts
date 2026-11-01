import { describe, expect, it } from 'vitest';

import { isGitHubUrl } from './isGitHubUrl';

describe('isGitHubUrl', () => {
  it.each([
    'https://github.com/lobehub/lobehub',
    'https://www.github.com/lobehub/lobehub',
    'https://gist.github.com/example',
  ])('accepts GitHub hosts: %s', (url) => {
    expect(isGitHubUrl(url)).toBe(true);
  });

  it.each([
    'https://evilgithub.com/lobehub/lobehub',
    'https://github.com.evil.example/lobehub/lobehub',
    'https://github.com@evil.example/lobehub/lobehub',
  ])('rejects hosts that only contain github.com: %s', (url) => {
    expect(isGitHubUrl(url)).toBe(false);
  });

  it.each([undefined, '', 'not-a-url'])('rejects invalid URLs: %s', (url) => {
    expect(isGitHubUrl(url)).toBe(false);
  });
});
