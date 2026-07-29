import { build, type Plugin } from 'vite';
import { describe, expect, it } from 'vitest';

import { lobeIconImports } from './lobeIconImports';

const ENTRY_ID = '\0lobe-icon-imports-fixture.mjs';

const fixturePlugin: Plugin = {
  name: 'lobe-icon-imports-fixture',
  load(id) {
    if (id !== ENTRY_ID) return;

    return `
      import { getLobeIconCDN, MCP } from '@lobehub/icons';
      export { getLobeIconCDN, MCP };
    `;
  },
  resolveId(id) {
    if (id === 'virtual:lobe-icon-imports-fixture') return ENTRY_ID;
  },
};

describe('lobeIconImports', () => {
  it('keeps icon barrel dependencies out of transformed .mjs modules', async () => {
    const result = await build({
      build: {
        minify: false,
        rolldownOptions: {
          external: /^@lobehub\/icons\/es\//,
          input: 'virtual:lobe-icon-imports-fixture',
        },
        write: false,
      },
      configFile: false,
      logLevel: 'silent',
      plugins: [fixturePlugin, ...lobeIconImports()],
    });

    const outputs = Array.isArray(result) ? result : [result];
    const code = outputs
      .flatMap(({ output }) => output)
      .filter((item) => item.type === 'chunk')
      .map((item) => item.code)
      .join('\n');

    expect(code).toContain('@lobehub/icons/es/MCP/index.js');
    expect(code).toContain('@lobehub/icons/es/features/getLobeIconCDN/index.js');
    expect(code).not.toMatch(/from ["']@lobehub\/icons["']/);
  });
});
