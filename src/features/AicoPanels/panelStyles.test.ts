import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('aicoPanelStyles tableScroll', () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'panelStyles.ts'),
    'utf8',
  );

  it('contains wide tables inside the panel instead of growing the page', () => {
    expect(source).toContain('tableScroll:');
    expect(source).toMatch(/tableScroll:[\s\S]*min-width:\s*0/);
    expect(source).toMatch(/tableScroll:[\s\S]*max-width:\s*100%/);
    expect(source).toMatch(/\.ant-table-wrapper[\s\S]*max-width:\s*100%/);
  });

  it('pins cell fills with inset 0 so RTL does not shift the background', () => {
    expect(source).toContain('.ant-table-cell::before');
    expect(source).toContain('inset: 0');
    expect(source).not.toContain('inset-inline: auto');
  });
});
