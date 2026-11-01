// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { stylexAliases } from './stylex';

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

describe('overlay StyleX aliases', () => {
  const overlayConsumer = `
import * as stylex from '@stylexjs/stylex';
import { overlay } from '@/overlay.stylex';

export const styles = stylex.create({ ring: { outline: overlay.ring } });
`;
  const overlayTokens = `
import * as stylex from '@stylexjs/stylex';

export const overlay = stylex.defineConsts({ ring: '3px solid rgb(1, 2, 3)' });
`;

  const withOverlayRepo = (run: (srcDir: string) => void) => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'stylex-overlay-')));
    try {
      const srcDir = path.join(dir, 'src');
      mkdirSync(srcDir);
      writeFileSync(path.join(srcDir, 'overlay.stylex.ts'), overlayTokens);
      run(srcDir);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  };

  const compile = (srcDir: string, aliases: ReturnType<typeof stylexAliases>) => {
    const { babel, plugin, processStylexRules } = loadCompiler();
    if (!processStylexRules) throw new Error('stylex babel plugin is missing processStylexRules');

    const transform = (filename: string, code: string) =>
      babel.transformSync(code, {
        babelrc: false,
        configFile: false,
        filename,
        plugins: [
          [
            plugin,
            {
              aliases,
              classNamePrefix: 'lh',
              dev: false,
              runtimeInjection: false,
              test: false,
              unstable_moduleResolution: { rootDir: root, type: 'commonJS' },
            },
          ],
        ],
        sourceType: 'module',
      })?.metadata?.stylex ?? [];

    return processStylexRules(
      [
        ...transform(path.join(srcDir, 'consumer.js'), overlayConsumer),
        ...transform(path.join(srcDir, 'overlay.stylex.ts'), overlayTokens),
      ],
      { useLayers: false },
    );
  };

  it('resolves @/ token files from an overlay repo src first', () => {
    withOverlayRepo((srcDir) => {
      const aliases = stylexAliases([srcDir]);
      expect(aliases['@/*']).toEqual([path.join(srcDir, '*'), path.join(root, 'src/*')]);
      expect(compile(srcDir, aliases)).toMatch(/outline:3px solid (rgb\(1, ?2, ?3\)|#010203)/);
    });
  });

  it('cannot resolve overlay token files without the overlay src dir', () => {
    withOverlayRepo((srcDir) => {
      expect(() => compile(srcDir, stylexAliases())).toThrow(/Could not resolve/);
    });
  });

  it('does not list this repo src twice', () => {
    expect(stylexAliases([path.join(root, 'src')])['@/*']).toEqual([path.join(root, 'src/*')]);
  });
});

describe('StyleX dev CSS collection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it('resolves token constants before the browser loads their modules', async () => {
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const { stylexPlugin } = await import('./stylex');
    const plugins = (stylexPlugin() as unknown[]).flat(Infinity) as Array<{
      __stylexCollectCss?: () => string;
      buildStart?: () => Promise<void> | void;
      transform?: (code: string, id: string) => Promise<unknown>;
    }>;
    const compiler = plugins.find((plugin) => plugin.__stylexCollectCss);
    if (!compiler?.buildStart || !compiler.transform || !compiler.__stylexCollectCss)
      throw new Error('StyleX compiler hooks are missing');

    await compiler.buildStart();
    await compiler.transform(consumerSource, path.join(root, 'src/stylex-token-consumer.js'));

    const css = compiler.__stylexCollectCss();
    expect(css).toContain('color: var(--lobe-color-text)');
    expect(css).toMatch(/@media[^{]+575\.98px/);
    expect(css).not.toMatch(/var\(--(?!lobe-)[^)]+\)/);
  });
});
