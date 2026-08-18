import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Control-plane SPA does not use AppTheme; Persian Tabs/Switch indicators
 * still need GlobalStyle (same RTL offset vs inset-inline-start fix as Settings).
 */
describe('ControlPlaneTheme RTL chrome', () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'ControlPlaneTheme.tsx'),
    'utf8',
  );

  it('mounts GlobalStyle so tab pills align under dir=rtl', () => {
    expect(source).toContain("from '@/styles'");
    expect(source).toContain('<GlobalStyle />');
  });
});
