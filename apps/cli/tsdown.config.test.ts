import { describe, expect, it } from 'vitest';

import config from './tsdown.config';

describe('CLI build configuration', () => {
  it('bundles ws so the desktop-embedded CLI runs without node_modules', () => {
    expect(config).toEqual(
      expect.objectContaining({
        deps: expect.objectContaining({ alwaysBundle: expect.arrayContaining(['ws']) }),
      }),
    );
  });
});
