import { build, type Plugin } from 'vite';
import { describe, expect, it } from 'vitest';

import { lobeUiImports, parseBarrel } from './lobeUiImports';

const ENTRY_ID = '\0lobe-ui-imports-fixture.mjs';

const fixturePlugin: Plugin = {
  name: 'lobe-ui-imports-fixture',
  load(id) {
    if (id !== ENTRY_ID) return;

    return `
      import { ConfigProvider, ErrorBoundary, Flexbox } from '@lobehub/ui';
      import { Button } from '@lobehub/ui/base-ui';
      export { ConfigProvider, ErrorBoundary, Flexbox, Button };
      export * from '@lobehub/ui/brand';
      export const loadToast = () => import('@lobehub/ui/base-ui');
    `;
  },
  resolveId(id) {
    if (id === 'virtual:lobe-ui-imports-fixture') return ENTRY_ID;
  },
};

describe('parseBarrel', () => {
  it('maps exported members to their source modules', () => {
    const code = [
      'import FlexBasic_default from "./Flex/FlexBasic.mjs";',
      'import Foo, { bar, baz as qux } from "./Foo/index.mjs";',
      'import { rehypeStreamAnimated } from "@lobehub/streamdown";',
      'export { FlexBasic_default as Flexbox, Foo, bar, qux, rehypeStreamAnimated };',
    ].join('\n');

    expect(parseBarrel(code, '')).toEqual({
      Flexbox: { imported: 'default', source: '@lobehub/ui/es/Flex/FlexBasic' },
      Foo: { imported: 'default', source: '@lobehub/ui/es/Foo/index' },
      bar: { imported: 'bar', source: '@lobehub/ui/es/Foo/index' },
      qux: { imported: 'baz', source: '@lobehub/ui/es/Foo/index' },
      rehypeStreamAnimated: { imported: 'rehypeStreamAnimated', source: '@lobehub/streamdown' },
    });
    expect(parseBarrel('import X from "../Foo/X.mjs";\nexport { X };', 'chat/')).toEqual({
      X: { imported: 'default', source: '@lobehub/ui/es/Foo/X' },
    });
  });
});

describe('lobeUiImports', () => {
  it('rewrites barrel imports to deep imports', async () => {
    const result = await build({
      build: {
        minify: false,
        rolldownOptions: {
          external: [/^@lobehub\/ui\/es\//, /node_modules\/react-error-boundary\//],
          input: 'virtual:lobe-ui-imports-fixture',
        },
        write: false,
      },
      configFile: false,
      logLevel: 'silent',
      plugins: [fixturePlugin, ...lobeUiImports()],
    });

    const outputs = Array.isArray(result) ? result : [result];
    const code = outputs
      .flatMap(({ output }) => output)
      .filter((item) => item.type === 'chunk')
      .map((item) => item.code)
      .join('\n');

    expect(code).toContain('@lobehub/ui/es/ConfigProvider/');
    expect(code).toContain('@lobehub/ui/es/Flex/FlexBasic');
    expect(code).toContain('@lobehub/ui/es/base-ui/');
    expect(code).toContain('react-error-boundary');
    expect(code).not.toMatch(/from ["']react-error-boundary["']/);
    expect(code).not.toMatch(/from ["']@lobehub\/ui["']/);
    expect(code).not.toMatch(/from ["']@lobehub\/ui\/base-ui["']/);
    expect(code).toContain('@lobehub/ui/es/brand/index');
    expect(code).toContain('@lobehub/ui/es/base-ui/index');
  });
});
