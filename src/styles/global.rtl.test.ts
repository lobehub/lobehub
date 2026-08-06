import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Regression: Persian (RTL) must not double-mirror Switch thumbs or place
 * Tabs/Segmented sliding backgrounds with logical inset against physical offsets.
 */
describe('global RTL control fixes', () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'global.ts'),
    'utf8',
  );

  it('keeps switches LTR under dir=rtl', () => {
    expect(source).toContain("html[dir='rtl'] [role='switch']");
    expect(source).toContain(":dir(rtl) [role='switch']");
    expect(source).toContain('--switch-dir: 1');
    expect(source).toContain('direction: ltr');
  });

  it('maps Tabs selection indicators to physical left (incl. Settings animation)', () => {
    // Ungated: physical left works in LTR and fixes RTL regardless of html.dir timing
    expect(source).toContain("[role='tablist'] > [role='presentation']");
    expect(source).toContain('left: var(--active-tab-left) !important');
    expect(source).toContain('inset-inline: auto !important');
    expect(source).toContain(
      'transition-property: left, top, inset-block-start, width, height, transform !important',
    );
    // Prior broken formula used containing-block % and --active-tab-right
    expect(source).not.toContain('var(--active-tab-right)');
    expect(source).not.toContain('(var(--active-tab-width) - 100%)');
  });

  it('maps Segmented selection indicators to physical left', () => {
    expect(source).toContain("[data-orientation] > [aria-hidden='true']:first-of-type");
    expect(source).toContain('left: var(--active-item-left) !important');
    expect(source).toContain('liberty/use-logical-spec');
  });
});
