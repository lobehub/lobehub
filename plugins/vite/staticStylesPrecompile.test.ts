// @vitest-environment node
import { build, parseAst, type Plugin } from 'vite';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  loadAntdStyleEvaluator,
  precompileStaticStyles,
  splitRules,
  viteStaticStylesPrecompile,
} from './staticStylesPrecompile';
import { insertPrecompiledStyle } from './staticStylesRuntime';

let evaluator: Awaited<ReturnType<typeof loadAntdStyleEvaluator>>;

beforeAll(async () => {
  evaluator = await loadAntdStyleEvaluator();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const CALLBACK = `({ css, responsive }) => ({
  root: css\`
    display: flex;
    color: \${cssVar.colorTextSecondary};
    &:hover { color: \${cssVar.colorText}; }
    \${responsive.mobile} { padding: 0; }
  \`,
  'text-2': css\`font-size: 12px;\`,
})`;

const PURE = `
import { createStaticStyles, cssVar } from 'antd-style';
export const styles = createStaticStyles(${CALLBACK});
`;

describe('splitRules', () => {
  it('splits top-level rules and keeps nested blocks together', () => {
    const css = `.a{color:red;}.a:hover{color:blue;}@media (max-width: 479.98px){.a{padding:0;}}.b{content:"}";}`;
    expect(splitRules(css)).toEqual([
      '.a{color:red;}',
      '.a:hover{color:blue;}',
      '@media (max-width: 479.98px){.a{padding:0;}}',
      '.b{content:"}";}',
    ]);
  });
});

describe('precompileStaticStyles', () => {
  it('replaces a pure callback with precompiled rules', () => {
    const output = precompileStaticStyles(PURE, evaluator)!;
    expect(output).not.toContain('createStaticStyles(');
    expect(output).toContain(
      "import { insertPrecompiledStyle as __lobeStaticStyle } from 'virtual:lobe-static-styles-runtime';",
    );
    expect(output).toMatch(
      /"root": __lobeStaticStyle\("acss-[a-z0-9]+", \[".acss-[a-z0-9]+\{display:/,
    );
    expect(output).toContain('color:var(--ant-color-text-secondary)');
    expect(output).toContain('@media (max-width: 479.98px){.acss-');
    expect(output).toContain('"text-2": __lobeStaticStyle(');
    expect(output).toMatch(
      /__lobeStaticStyle\("acss-[a-z0-9]+", \["\.acss-[a-z0-9]+\{font-size:12px;\}"\], "font-size: 12px;"\)/,
    );
  });

  it('matches the class names antd-style produces at runtime', () => {
    const output = precompileStaticStyles(PURE, evaluator)!;

    const callback = new Function('cssVar', `return ${CALLBACK};`)(evaluator.cssVar);
    const runtime = evaluator.createStaticStyles(callback);
    expect(output).toContain(`"root": __lobeStaticStyle("${runtime.root}"`);
    expect(output).toContain(`"text-2": __lobeStaticStyle("${runtime['text-2']}"`);
  });

  it('drops legacy vendor prefixes but keeps the ones Safari still needs', () => {
    const code = `
import { createStaticStyles } from 'antd-style';
export const styles = createStaticStyles(({ css }) => ({
  root: css\`
    display: flex;
    user-select: none;
    backdrop-filter: blur(4px);
    transition: opacity 0.2s;
    -webkit-line-clamp: 2;
  \`,
}));
`;
    const output = precompileStaticStyles(code, evaluator)!;
    expect(output).toContain(
      '{display:flex;-webkit-user-select:none;user-select:none;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);transition:opacity 0.2s;-webkit-line-clamp:2;}',
    );
    expect(output).not.toContain('-ms-');
    expect(output).not.toContain('-webkit-box');
  });

  it('supports aliased antd-style utils', () => {
    const code = `
import { createStaticStyles as make, cssVar as cv } from 'antd-style';
const styles = make(({ css }) => ({ root: css\`color: \${cv.colorText};\` }));
`;
    expect(precompileStaticStyles(code, evaluator)).toContain('color:var(--ant-color-text)');
  });

  it('leaves callbacks that reference module scope untouched', () => {
    const code = `
import { createStaticStyles, cssVar } from 'antd-style';
const GAP = 8;
export const styles = createStaticStyles(({ css }) => ({ root: css\`gap: \${GAP}px;\` }));
`;
    expect(precompileStaticStyles(code, evaluator)).toBeUndefined();
  });

  it('leaves callbacks that call runtime helpers untouched', () => {
    const code = `
import { createStaticStyles, cssVar } from 'antd-style';
import { isDesktop } from '@lobechat/const';
export const styles = createStaticStyles(({ css }) => ({
  root: css\`padding: \${isDesktop ? 32 : 8}px;\`,
}));
`;
    expect(precompileStaticStyles(code, evaluator)).toBeUndefined();
  });

  it('compiles pure calls and keeps impure siblings in the same file', () => {
    const code = `
import { createStaticStyles, cssVar } from 'antd-style';
const SIZE = 4;
export const a = createStaticStyles(({ css }) => ({ root: css\`color: \${cssVar.colorText};\` }));
export const b = createStaticStyles(({ css }) => ({ root: css\`width: \${SIZE}px;\` }));
`;
    const output = precompileStaticStyles(code, evaluator)!;
    expect(output).toContain('export const a = ({ "root": __lobeStaticStyle(');
    expect(output).toContain('export const b = createStaticStyles(');
  });

  it('keeps a bare expression statement syntactically valid', () => {
    const code = `
import { createStaticStyles, cssVar } from 'antd-style';
createStaticStyles(({ css }) => ({ root: css\`color: \${cssVar.colorText};\` }));
`;
    const output = precompileStaticStyles(code, evaluator)!;
    expect(output).toMatch(/\n\(\{ "root": __lobeStaticStyle\(/);
    expect(() => parseAst(output)).not.toThrow();
  });

  it('ignores files without an antd-style import', () => {
    const code = `
import { createStaticStyles } from './local';
export const styles = createStaticStyles(({ css }) => ({ root: css\`color: red;\` }));
`;
    expect(precompileStaticStyles(code, evaluator)).toBeUndefined();
  });
});

describe('insertPrecompiledStyle', () => {
  it('inserts rules once and exposes emotion-mergeable registered styles', async () => {
    const { createStaticStyles, css, cx, styleManager } = (await import('antd-style')) as any;
    const insert = vi.fn();
    const insertSpy = vi.spyOn(styleManager.cache.sheet, 'insert').mockImplementation(insert);
    const rules = ['.acss-fixture{color:red;}', '.acss-fixture:hover{color:blue;}'];
    const registered = 'color:red;&:hover{color:blue;}';

    expect(insertPrecompiledStyle('acss-fixture', rules, registered)).toBe('acss-fixture');
    insertPrecompiledStyle('acss-fixture', rules, registered);
    expect(insert.mock.calls.map(([rule]) => rule)).toEqual(rules);
    expect(styleManager.cache.registered['acss-fixture']).toBe(registered);

    const merged = cx(
      'acss-fixture',
      css`
        margin: 0;
      `,
    );
    expect(merged).not.toBe('acss-fixture');
    expect(styleManager.cache.registered[merged]).toContain(registered);
    expect(styleManager.cache.registered[merged]).toContain('margin: 0;');

    const composed = createStaticStyles(({ css: s }: any) => ({
      x: s`${'acss-fixture'} padding: 0;`,
    })).x;
    expect(styleManager.cache.inserted[composed.slice(5)]).toContain(
      `.${composed}:hover{color:blue;}`,
    );

    styleManager.cache.registered['acss-fixture'] = 'color: green;';
    expect(styleManager.cache.registered['acss-fixture']).toBe('color: green;');
    insertSpy.mockRestore();
  });

  it.each([
    ['padding-block:12px;padding-inline:12px;', 'padding:0;'],
    [
      'padding-block:12px;--lobe-popover-viewport-inline-padding:12px;',
      'padding-block:0px;--lobe-popover-viewport-inline-padding:0px;',
    ],
    [
      'color:red;&:hover{color:orange;}@media(min-width:600px){color:green;}',
      'color:blue;&:hover{color:purple;}@media(min-width:600px){color:black;}',
    ],
  ])('preserves runtime composition for %s', async (base, override) => {
    const { createStaticStyles, cx, styleManager } = await import('antd-style');
    const makeStyle = (value: string) =>
      createStaticStyles(({ css }) => ({ root: css(value) })).root;
    const composeStyle = (className: string) =>
      createStaticStyles(({ css }) => ({
        root: css`
          ${className}${override}
        `,
      })).root;
    vi.spyOn(styleManager.cache.sheet, 'insert').mockImplementation(() => {});
    const source = `import { createStaticStyles } from 'antd-style';
      const styles = createStaticStyles(({ css }) => ({ root: css(${JSON.stringify(base)}) }));`;
    const output = precompileStaticStyles(source, evaluator)!;
    const run = new Function(
      '__lobeStaticStyle',
      `${output.replaceAll(/^import .*;\n/gm, '')}\nreturn styles.root;`,
    );
    const precompiled = run(insertPrecompiledStyle);
    const runtimeOverride = makeStyle(override);
    const mixed = cx(precompiled, runtimeOverride);
    const reversed = cx(runtimeOverride, precompiled);
    const interpolated = composeStyle(precompiled);

    delete styleManager.cache.registered[precompiled];
    const runtimeBase = makeStyle(base);
    expect(mixed).toBe(cx(runtimeBase, runtimeOverride));
    expect(reversed).toBe(cx(runtimeOverride, runtimeBase));
    expect(interpolated).toBe(composeStyle(runtimeBase));
    expect(styleManager.cache.inserted[mixed.slice(styleManager.cache.key.length + 1)]).toContain(
      override.split(';')[0],
    );
  });
});

describe('viteStaticStylesPrecompile', () => {
  const ENTRY_ID = '\0lobe-static-styles-fixture.mjs';
  const fixturePlugin: Plugin = {
    load(id) {
      if (id === ENTRY_ID) return PURE;
    },
    name: 'lobe-static-styles-fixture',
    resolveId(id) {
      if (id === 'virtual:lobe-static-styles-fixture') return ENTRY_ID;
    },
  };

  it('bundles precompiled styles against the antd-style runtime', async () => {
    const result = await build({
      build: {
        minify: false,
        rolldownOptions: {
          external: ['antd-style'],
          input: 'virtual:lobe-static-styles-fixture',
        },
        write: false,
      },
      configFile: false,
      logLevel: 'silent',
      plugins: [fixturePlugin, viteStaticStylesPrecompile()],
    });

    const outputs = Array.isArray(result) ? result : [result];
    const code = outputs
      .flatMap(({ output }) => output)
      .filter((item) => item.type === 'chunk')
      .map((item) => item.code)
      .join('\n');

    expect(code).not.toContain('createStaticStyles');
    expect(code).toMatch(/import \{ styleManager \} from ["']antd-style["']/);
    expect(code).toContain('cache.sheet.insert(rule)');
    expect(code).toContain('color:var(--ant-color-text-secondary)');
  });
});
