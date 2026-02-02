import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { generatePKCE } from './pkce';

describe('generatePKCE', () => {
  it('returns codeVerifier and codeChallenge of correct format', () => {
    const { codeChallenge, codeVerifier } = generatePKCE();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeVerifier.length).toBeGreaterThanOrEqual(32);
    expect(codeChallenge.length).toBe(43); // base64url of sha256 digest
  });

  it('codeChallenge is S256 of codeVerifier', () => {
    const { codeChallenge, codeVerifier } = generatePKCE();
    const expected = createHash('sha256').update(codeVerifier).digest('base64url');
    expect(codeChallenge).toBe(expected);
  });

  it('generates unique values each call', () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });
});
