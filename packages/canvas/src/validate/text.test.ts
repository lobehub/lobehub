import { describe, expect, it } from 'vitest';

import { collectCssRefs } from './text';

describe('collectCssRefs', () => {
  it('collects url() and @import references', () => {
    const css = `@import "theme.css"; .a { background: url('img/bg.png'); } .b { mask: url(icons.svg) }`;

    expect(collectCssRefs(css).map((ref) => ref.href)).toEqual([
      'img/bg.png',
      'icons.svg',
      'theme.css',
    ]);
  });

  it('scans adversarial url( runs in linear time', () => {
    const started = performance.now();
    collectCssRefs('url(!'.repeat(40_000));

    expect(performance.now() - started).toBeLessThan(500);
  });
});
