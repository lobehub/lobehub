// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('home input banner queue', () => {
  it('hides every banner after the first with a rule that outranks the banner StyleX display', () => {
    const css = readFileSync(
      path.resolve(__dirname, '../../src/features/Home/InputArea/InputBanner.module.css'),
      'utf8',
    );

    // The banner's own `display: flex` is StyleX, which beats a plain class rule on specificity.
    expect(css).toMatch(
      /~ :global\(\[data-home-input-banner\]\)\s*\{[^}]*display: none !important/,
    );
  });
});
