import { describe, expect, it } from 'vitest';

import { isPublicHttpsUrl } from './publicHttpsUrl';

describe('public HTTPS callback URL', () => {
  it.each([
    'https://lobehub.example.com',
    'https://lobehub.example.com/',
    'https://lobehub.example.com/path',
  ])('accepts public URL %s', (url) => expect(isPublicHttpsUrl(url)).toBe(true));
  it.each([
    'bad',
    'http://app.example.com',
    'https://localhost',
    'https://x.localhost',
    'https://x.internal',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost.',
    'https://u:p@app.example.com',
  ])('rejects unreachable or unsafe callback %s', (url) =>
    expect(isPublicHttpsUrl(url)).toBe(false),
  );
});
