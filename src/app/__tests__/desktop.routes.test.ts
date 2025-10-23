import fs from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Desktop Routes', () => {
  const appRootDir = resolve(__dirname, '..');

  const desktopRoutes = [
    '(backend)/trpc/desktop/[trpc]/route.ts',
    'desktop/devtools/page.tsx',
    'desktop/layout.tsx',
  ];

  it.each(desktopRoutes)('should have file: %s', (route) => {
    const filePath = resolve(appRootDir, route);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
