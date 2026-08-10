/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { config } from './proxy';

describe('proxy matcher', () => {
  it('includes auth legal routes so middleware can rewrite them to the auth SPA', () => {
    expect(config.matcher).toEqual(
      expect.arrayContaining(['/terms(.*)', '/privacy(.*)', '/signin(.*)']),
    );
  });
});
