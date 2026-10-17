// @vitest-environment node
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

type TransformResult = {
  metadata?: { stylex?: unknown[] };
};

type Babel = {
  transformSync: (code: string, options: Record<string, unknown>) => TransformResult | null;
};

type StylexPlugin = ((api: unknown) => unknown) & {
  processStylexRules?: (rules: unknown[], config?: { useLayers?: boolean }) => string;
};

const root = path.resolve(import.meta.dirname, '../..');

const loadCompiler = () => {
  const rootRequire = createRequire(path.join(root, 'package.json'));
  const unpluginEntry = realpathSync(rootRequire.resolve('@stylexjs/unplugin'));
  const unpluginRoot = path.resolve(path.dirname(unpluginEntry), '..');
  const req = createRequire(path.join(unpluginRoot, 'package.json'));
  const loaded = req('@stylexjs/babel-plugin') as StylexPlugin & { default?: StylexPlugin };
  const plugin = loaded.default ?? loaded;

  return {
    babel: req('@babel/core') as Babel,
    plugin,
    processStylexRules: plugin.processStylexRules ?? loaded.processStylexRules,
    resolve: (specifier: string) => rootRequire.resolve(specifier),
  };
};

const consumerSource = `
import * as stylex from '@stylexjs/stylex';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';

export const styles = stylex.create({
  title: {
    color: cssVar.colorText,
    fontSize: { default: 16, [media.sm]: 14 },
  },
});
`;

describe('@lobehub/ui StyleX tokens', () => {
  it('inlines published defineConsts into app CSS', () => {
    const { babel, plugin, processStylexRules, resolve } = loadCompiler();
    if (!processStylexRules) throw new Error('stylex babel plugin is missing processStylexRules');

    const cssVarFile = resolve('@lobehub/ui/stylex/cssVar.stylex');
    const mediaFile = resolve('@lobehub/ui/stylex/media.stylex');
    expect(readFileSync(cssVarFile, 'utf8')).toContain(
      'export const cssVar = stylex.defineConsts(',
    );
    expect(readFileSync(mediaFile, 'utf8')).toContain('export const media = stylex.defineConsts(');

    const options = {
      classNamePrefix: 'lh',
      dev: false,
      runtimeInjection: false,
      test: false,
      unstable_moduleResolution: { rootDir: root, type: 'commonJS' },
    };
    const transform = (filename: string, code = readFileSync(filename, 'utf8')) => {
      const result = babel.transformSync(code, {
        babelrc: false,
        configFile: false,
        filename,
        plugins: [[plugin, options]],
        sourceType: 'module',
      });
      return result?.metadata?.stylex ?? [];
    };

    const css = processStylexRules(
      [
        ...transform(path.join(root, 'src/stylex-token-consumer.js'), consumerSource),
        ...transform(cssVarFile),
        ...transform(mediaFile),
      ],
      { useLayers: false },
    );

    expect(css).toContain('color:var(--lobe-color-text)');
    expect(css).toContain('@media (max-width: 575.98px)');
    expect(css).toMatch(/\.lh/);
    expect(css.match(/var\(--(?!lobe-)[^)]+\)/g)).toBeNull();
  });
});
