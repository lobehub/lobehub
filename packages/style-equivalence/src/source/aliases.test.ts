import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { globalCssAdapter } from '../extract/adapters/globalCss';
import { extractFile } from '../extract/index';
import { stylesheetReader } from '../pipeline/synthesize';
import { aliasCandidates } from './aliases';
import { resolveSpecifier } from './declarations';

let root: string;

const put = async (file: string, text: string) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'style-eq-aliases-'));
  await put(
    'tsconfig.json',
    `{
      // comments are allowed here, as in the app's own tsconfig
      "compilerOptions": {
        "paths": {
          "@/utils/*": ["./packages/utils/src/*", "./src/utils/*"],
          "@/*": ["./src/*"],
          "~fixture": ["./tests/fixture.ts"]
        }
      }
    }`,
  );
  await put('src/features/shared/breadcrumb.css', '.crumb ol { flex-wrap: nowrap; }\n');
  await put('src/utils/format.ts', 'export const format = 1;\n');
  await put('tests/fixture.ts', 'export const fixture = 1;\n');
  await put(
    'node_modules/@flow/react/package.json',
    JSON.stringify({ exports: { '.': './dist/index.js' }, name: '@flow/react' }),
  );
  await put('node_modules/@flow/react/dist/index.js', 'export {};\n');
  await put('node_modules/@flow/react/dist/style.css', '.flow__node { color: red; }\n');
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

describe('specifiers resolved the way the app resolves them', () => {
  it('prefers the longest tsconfig path and keeps its targets in order', () => {
    expect(aliasCandidates(root, '@/utils/format', {})).toEqual([
      'packages/utils/src/format',
      'src/utils/format',
    ]);
    expect(aliasCandidates(root, '~fixture', {})).toEqual(['tests/fixture.ts']);
    expect(aliasCandidates(root, 'react', {})).toEqual([]);
  });

  it('falls through to the next target when the first does not exist', () => {
    expect(resolveSpecifier(root, 'src/a.tsx', '@/utils/format', {})).toBe('src/utils/format.ts');
  });

  it('reads a plain stylesheet imported through an alias', () => {
    const read = stylesheetReader(root, { '@/': 'src/' });
    expect(read('src/features/a/A.tsx', '@/features/shared/breadcrumb.css')).toContain('.crumb ol');
    expect(stylesheetReader(root)('src/a.tsx', '@/features/shared/breadcrumb.css')).toContain(
      'nowrap',
    );
  });

  it('reads a package stylesheet from node_modules even when its exports map hides it', () => {
    expect(stylesheetReader(root)('src/a.tsx', '@flow/react/dist/style.css')).toContain(
      '.flow__node',
    );
    expect(stylesheetReader(root)('src/a.tsx', '@flow/react/dist/missing.css')).toBeUndefined();
  });

  it('extracts rules from an aliased stylesheet with no unreadable gap', () => {
    const code = `import '@/features/shared/breadcrumb.css';

export const A = () => <nav className="crumb" />;
`;
    const extraction = extractFile(code, 'src/features/a/A.tsx', {
      adapters: [globalCssAdapter],
      layoutComponents: [],
      readStylesheet: stylesheetReader(root),
    });
    expect(extraction.gaps).toEqual([]);
    expect(extraction.rules.map((rule) => rule.selector)).toEqual(['.crumb ol']);
    expect(extraction.elements[0].slots).toEqual(['global.crumb']);
  });
});

describe('a package stylesheet nobody can read', () => {
  it('needs no sign-off when both sides import it the same way, and does when one side adds it', async () => {
    const { planFile } = await import('../plan/planFile');
    const code = (css: string) => `${css}\nexport const A = () => <div className={styles.a} />;\n`;
    const extract = (text: string) =>
      extractFile(text, 'src/a.tsx', {
        adapters: [globalCssAdapter],
        layoutComponents: [],
        readStylesheet: () => undefined,
      });
    const both = extract(code("import '@gone/pkg/dist/style.css';"));
    expect(both.gaps).toEqual(['STYLESHEET_UNREADABLE:@gone/pkg/dist/style.css']);
    expect(planFile('src/a.tsx', both, both, { layoutComponents: [] }).gaps).toEqual([]);
    const none = extract(code(''));
    expect(planFile('src/a.tsx', none, both, { layoutComponents: [] }).gaps).toEqual([
      'STYLESHEET_UNREADABLE:@gone/pkg/dist/style.css',
    ]);
    const local = extract(code("import './gone.css';"));
    expect(planFile('src/a.tsx', local, local, { layoutComponents: [] }).gaps).toEqual([
      'STYLESHEET_UNREADABLE:./gone.css',
    ]);
  });
});
