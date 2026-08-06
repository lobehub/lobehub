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

  it('forces LTR on Tabs/Segmented indicators so inset-inline-start matches physical left', () => {
    expect(source).toContain("[role='tablist'] > [role='presentation']");
    expect(source).toContain("[data-orientation] > [aria-hidden='true']:first-of-type");
    expect(source).toMatch(/\[role='tablist'\] > \[role='presentation'\][\s\S]*?direction:\s*ltr/);
    // Prior broken approaches (inset-inline:auto wiped left under RTL)
    expect(source).not.toContain('inset-inline: auto');
    expect(source).not.toContain('var(--active-tab-right)');
    expect(source).not.toContain('(var(--active-tab-width) - 100%)');
  });
});
