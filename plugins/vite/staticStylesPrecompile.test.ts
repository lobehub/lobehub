// @vitest-environment node
import { build, parseAst, type Plugin } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  BASE_LAYERS,
  buildStaticStylesCss,
  loadAntdStyleEvaluator,
  precompileStaticStyles,
  splitRules,
  viteStaticStylesPrecompile,
} from './staticStylesPrecompile';
import { layerRule } from './staticStylesRuntime';

let evaluator: Awaited<ReturnType<typeof loadAntdStyleEvaluator>>;

beforeAll(async () => {
  evaluator = await loadAntdStyleEvaluator();
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
  it('replaces a pure callback with plain class names and collects its rules', () => {
    const output = precompileStaticStyles(PURE, evaluator)!;
    expect(output.code).not.toContain('createStaticStyles(');
    expect(output.code).toContain("import 'virtual:lobe-static-styles-runtime';");
    expect(output.code).toMatch(/"root": "acss-[a-z0-9]+"/);
    expect(output.code).toMatch(/"text-2": "acss-[a-z0-9]+"/);
    expect(output.code).not.toContain('font-size');
    expect(output.rules.join('')).toContain('color:var(--ant-color-text-secondary)');
    expect(output.rules.join('')).toContain('@media (max-width: 479.98px){.acss-');
    expect(output.rules).toContainEqual(
      expect.stringMatching(/^\.acss-[a-z0-9]+\{font-size:12px;\}$/),
    );
  });

  it('matches the class names antd-style produces at runtime', () => {
    const output = precompileStaticStyles(PURE, evaluator)!;

    const callback = new Function('cssVar', `return ${CALLBACK};`)(evaluator.cssVar);
    const runtime = evaluator.createStaticStyles(callback);
    expect(output.code).toContain(`"root": "${runtime.root}"`);
    expect(output.code).toContain(`"text-2": "${runtime['text-2']}"`);
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
    const css = precompileStaticStyles(code, evaluator)!.rules.join('');
    expect(css).toContain(
      '{display:flex;-webkit-user-select:none;user-select:none;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);transition:opacity 0.2s;-webkit-line-clamp:2;}',
    );
    expect(css).not.toContain('-ms-');
    expect(css).not.toContain('-webkit-box');
  });

  it('supports aliased antd-style utils', () => {
    const code = `
import { createStaticStyles as make, cssVar as cv } from 'antd-style';
const styles = make(({ css }) => ({ root: css\`color: \${cv.colorText};\` }));
`;
    expect(precompileStaticStyles(code, evaluator)!.rules.join('')).toContain(
      'color:var(--ant-color-text)',
    );
  });

  it('leaves callbacks that reference module scope untouched', () => {
    const code = `
import { createStaticStyles, cssVar } from 'antd-style';
const GAP = 8;
export const styles = createStaticStyles(({ css }) => ({ root: css\`gap: \${GAP}px;\` }));
`;
    const output = precompileStaticStyles(code, evaluator)!;
    expect(output.rules).toEqual([]);
    expect(output.code).toBe(`import 'virtual:lobe-static-styles-runtime';\n${code}`);
  });

  it('leaves callbacks that call runtime helpers untouched', () => {
    const code = `
import { createStaticStyles, cssVar } from 'antd-style';
import { isDesktop } from '@lobechat/const';
export const styles = createStaticStyles(({ css }) => ({
  root: css\`padding: \${isDesktop ? 32 : 8}px;\`,
}));
`;
    const output = precompileStaticStyles(code, evaluator)!;
    expect(output.rules).toEqual([]);
    expect(output.code).toContain('export const styles = createStaticStyles(({ css })');
  });

  it('compiles pure calls and keeps impure siblings in the same file', () => {
    const code = `
import { createStaticStyles, cssVar } from 'antd-style';
const SIZE = 4;
export const a = createStaticStyles(({ css }) => ({ root: css\`color: \${cssVar.colorText};\` }));
export const b = createStaticStyles(({ css }) => ({ root: css\`width: \${SIZE}px;\` }));
`;
    const output = precompileStaticStyles(code, evaluator)!;
    expect(output.code).toMatch(/export const a = \(\{ "root": "acss-[a-z0-9]+" \}\);/);
    expect(output.code).toContain('export const b = createStaticStyles(({ css })');
    expect(output.rules).toHaveLength(1);
  });

  it('keeps a bare expression statement syntactically valid', () => {
    const code = `
import { createStaticStyles, cssVar } from 'antd-style';
createStaticStyles(({ css }) => ({ root: css\`color: \${cssVar.colorText};\` }));
`;
    const output = precompileStaticStyles(code, evaluator)!.code;
    expect(output).toMatch(/\n\(\{ "root": "acss-/);
    expect(() => parseAst(output)).not.toThrow();
  });

  it('only adds the runtime import to files that use antd-style without static styles', () => {
    const code = `
import { css } from 'antd-style';
export const cls = css\`color: red;\`;
`;
    const output = precompileStaticStyles(code, evaluator)!;
    expect(output.rules).toEqual([]);
    expect(output.code).toBe(`import 'virtual:lobe-static-styles-runtime';\n${code}`);
  });

  it('ignores files without an antd-style import', () => {
    const code = `
import { createStaticStyles } from './local';
export const styles = createStaticStyles(({ css }) => ({ root: css\`color: red;\` }));
`;
    expect(precompileStaticStyles(code, evaluator)).toBeUndefined();
  });
});

describe('buildStaticStylesCss', () => {
  it('declares the layer order once and groups rules per depth', () => {
    const css = buildStaticStylesCss([
      { depth: 5, rules: ['.a{x:1;}', '.b{x:2;}'] },
      { depth: 2, rules: ['.c{x:3;}'] },
      { depth: 5, rules: ['.a{x:1;}'] },
    ]);
    expect(css.split('\n')).toEqual([
      `@layer ${BASE_LAYERS.join(',')},l2,l5;`,
      '@layer l2{.c{x:3;}}',
      '@layer l5{.a{x:1;}.b{x:2;}}',
    ]);
  });
});

describe('runtime', () => {
  it('wraps runtime-inserted rules in the lobe-runtime layer and keeps layered rules as they are', () => {
    expect(layerRule('.acss-x{color:red;}')).toBe('@layer lobe-runtime{.acss-x{color:red;}}');
    expect(layerRule('@media (min-width:1px){.a{b:c;}}')).toBe(
      '@layer lobe-runtime{@media (min-width:1px){.a{b:c;}}}',
    );
    expect(layerRule('@layer l3{.acss-y{color:blue;}}')).toBe('@layer l3{.acss-y{color:blue;}}');
    expect(layerRule('@import url(x.css);')).toBe('@import url(x.css);');
  });

  it('lets cx merge precompiled classes by reading their rules from the extracted stylesheet', async () => {
    const { css, cx, styleManager } = (await import('antd-style')) as any;
    const rule = (selectorText: string, cssText: string) => ({ cssText, selectorText });
    const sheet = {
      cssRules: [
        {
          cssRules: [
            rule('.acss-fixture', '.acss-fixture { color: red; }'),
            rule('.acss-fixture:hover', '.acss-fixture:hover { color: blue; }'),
            rule('.acss-other', '.acss-other { margin: 0px; }'),
          ],
        },
      ],
      ownerNode: { hasAttribute: (name: string) => name === 'data-lobe-static-styles' },
    };
    vi.stubGlobal('document', { styleSheets: [sheet] });
    try {
      expect(styleManager.cache.registered['acss-fixture']).toBe(
        '& { color: red; }&:hover { color: blue; }',
      );
      expect(styleManager.cache.registered['acss-missing']).toBeUndefined();
      expect(styleManager.cache.registered['ant-btn']).toBeUndefined();
      expect(cx('acss-fixture')).toBe('acss-fixture');

      const merged = cx(
        'acss-fixture',
        css`
          margin: 0;
        `,
      );
      expect(merged).not.toContain('acss-fixture');
      expect(styleManager.cache.registered[merged]).toContain('& { color: red; }');
      expect(styleManager.cache.registered[merged]).toContain('margin: 0;');
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('emits the precompiled rules as a layered css asset', async () => {
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
    const items = outputs.flatMap(({ output }) => output);
    const code = items
      .filter((item) => item.type === 'chunk')
      .map((item) => item.code)
      .join('\n');
    const css = items.find((item) => item.type === 'asset' && item.fileName.endsWith('.css'));

    expect(code).not.toContain('createStaticStyles');
    expect(code).toMatch(/import \{ styleManager \} from ["']antd-style["']/);
    expect(code).toContain('lobe-runtime');
    expect(code).not.toContain('color:var(--ant-color-text-secondary)');
    expect(String(css && 'source' in css ? css.source : '')).toMatch(
      /^@layer antd,lobe-popup,lobe-base,lobe-runtime,l\d+;\n@layer l\d+\{\.acss-[a-z0-9]+\{display:flex;color:var\(--ant-color-text-secondary\);\}/,
    );
  });
});
