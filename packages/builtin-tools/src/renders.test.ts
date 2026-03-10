import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('getBuiltinRender', () => {
  it('should fallback credentials render to default renderer', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renders.ts'), 'utf8');

    expect(source).not.toContain(
      "import { CredentialsRenders } from '@lobechat/builtin-tool-credentials/client';",
    );
    expect(source).not.toContain('[CredentialsManifest.identifier]: CredentialsRenders');
    expect(source).toContain('[WebBrowsingManifest.identifier]: WebBrowsingRenders');
  });
});
