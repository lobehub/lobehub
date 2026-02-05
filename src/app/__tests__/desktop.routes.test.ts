import fs from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Desktop Routes', () => {
  const appRootDir = resolve(__dirname, '..');

  /**
   * Desktop-specific "routes" used by the desktop app are implemented via:
   * - backend desktop OIDC callback route
   * - desktop router configs/components under `[variants]/router`
   *
   * This test is intentionally a "smoke check" to prevent accidental deletion.
   */
  const desktopRelatedEntries = [
    '(backend)/oidc/callback/desktop/route.ts',
    '[variants]/router/DesktopClientRouter.tsx',
    '[variants]/router/desktopRouter.config.tsx',
  ];

  it.each(desktopRelatedEntries)('should have file: %s', (entry) => {
    const filePath = resolve(appRootDir, entry);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
