import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('user onboarding slice — first-screen imports', () => {
  // This store is on the first screen. A static import of the builtin-tools entry
  // pulls every tool manifest into the entry chunk (+327 KB gzip on the size gate).
  it.each(['@lobechat/builtin-tools', '@lobechat/mecha/builtinSkillGate'])(
    'does not statically import %s',
    (specifier) => {
      const source = readFileSync(path.join(__dirname, 'action.ts'), 'utf8');
      const staticImport = new RegExp(`^import(?!\\s+type)[^;]*from '${specifier}'`, 'm');

      expect(source).not.toMatch(staticImport);
    },
  );
});
