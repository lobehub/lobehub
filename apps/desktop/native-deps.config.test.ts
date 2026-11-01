import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const macNotificationsPackage = JSON.parse(
  readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../packages/electron-mac-notifications/package.json',
    ),
    'utf8',
  ),
) as { scripts?: Record<string, string> };

describe('first-party native addon install scripts', () => {
  it('overrides implicit node-gyp rebuild for the darwin-only notifications addon', () => {
    expect(macNotificationsPackage.scripts?.install).toBe('node scripts/build-native.mjs');
  });
});
