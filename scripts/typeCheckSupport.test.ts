import { describe, expect, it } from 'vitest';

import { bunCheckSupported } from './typeCheckSupport';

describe('bunCheckSupported', () => {
  it('accepts Bun 1.4.3 and canary builds of that line', () => {
    expect(bunCheckSupported('1.4.3')).toBe(true);
    expect(bunCheckSupported('1.4.3-canary.1+bd599f5af')).toBe(true);
    expect(bunCheckSupported('1.5.0')).toBe(true);
    expect(bunCheckSupported('2.0.0')).toBe(true);
  });

  it('rejects older Bun and missing versions', () => {
    expect(bunCheckSupported(undefined)).toBe(false);
    expect(bunCheckSupported('')).toBe(false);
    expect(bunCheckSupported('1.4.2')).toBe(false);
    expect(bunCheckSupported('1.3.2')).toBe(false);
    expect(bunCheckSupported('not-a-version')).toBe(false);
  });
});
