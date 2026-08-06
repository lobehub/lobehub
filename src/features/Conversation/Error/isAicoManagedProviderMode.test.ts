import { describe, expect, it } from 'vitest';

import { isAicoManagedProviderMode } from './isAicoManagedProviderMode';

describe('isAicoManagedProviderMode', () => {
  it('defaults to managed when status is unknown', () => {
    expect(isAicoManagedProviderMode(undefined)).toBe(true);
  });

  it('respects explicit managed flag', () => {
    expect(isAicoManagedProviderMode(true)).toBe(true);
    expect(isAicoManagedProviderMode(false)).toBe(false);
  });
});
