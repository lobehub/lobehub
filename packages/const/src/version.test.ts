import { describe, expect, it } from 'vitest';

import { AICO_PRODUCT_VERSION, CURRENT_VERSION } from './version';

describe('Aico product version', () => {
  it('is 0.9.1 and is what Settings → About falls back to', () => {
    expect(AICO_PRODUCT_VERSION).toBe('0.9.1');
    expect(CURRENT_VERSION).toBe(AICO_PRODUCT_VERSION);
  });
});
