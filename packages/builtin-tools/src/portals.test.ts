import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('BuiltinToolsPortals', () => {
  it('should fallback credentials tool ui to default renderer', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/portals.ts'), 'utf8');

    expect(source).not.toContain(
      "import { CredentialsPortal } from '@lobechat/builtin-tool-credentials/client';",
    );
    expect(source).not.toContain('[CredentialsManifest.identifier]: CredentialsPortal');
    expect(source).toContain('[WebBrowsingManifest.identifier]: WebBrowsingPortal');
  });
});
