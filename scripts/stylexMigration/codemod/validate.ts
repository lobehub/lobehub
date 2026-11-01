import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { ESLint } from 'eslint';
import * as prettier from 'prettier';

type Babel = {
  transformSync: (code: string, options: Record<string, unknown>) => unknown;
};

const repoRoot = path.resolve(import.meta.dirname, '../../..');

// The compiler the SPA build runs, resolved through @stylexjs/unplugin.
const loadCompiler = () => {
  const rootRequire = createRequire(path.join(repoRoot, 'package.json'));
  const unpluginEntry = realpathSync(rootRequire.resolve('@stylexjs/unplugin'));
  const req = createRequire(
    path.join(path.resolve(path.dirname(unpluginEntry), '..'), 'package.json'),
  );
  const loaded = req('@stylexjs/babel-plugin') as { default?: unknown };
  return { babel: req('@babel/core') as Babel, plugin: loaded.default ?? loaded };
};

let compiler: ReturnType<typeof loadCompiler> | undefined;
let eslint: ESLint | undefined;

/** Throws when the StyleX compiler rejects the file. */
export const compileStylex = (code: string, filename: string) => {
  compiler ??= loadCompiler();
  compiler.babel.transformSync(code, {
    babelrc: false,
    configFile: false,
    filename,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [
      [
        compiler.plugin,
        {
          classNamePrefix: 'lh',
          dev: false,
          runtimeInjection: false,
          test: false,
          unstable_moduleResolution: { rootDir: repoRoot, type: 'commonJS' },
        },
      ],
    ],
    sourceType: 'module',
  });
};

/** Formats with the repository prettier config, as the pre-commit hook does. */
export const format = async (code: string, filePath: string) => {
  const config = await prettier.resolveConfig(filePath);
  return prettier.format(code, { ...config, filepath: filePath });
};

/** Lints with autofix; returns the fixed code and every remaining error. */
export const lintAndFix = async (code: string, filePath: string) => {
  eslint ??= new ESLint({ cwd: repoRoot, fix: true });
  const [result] = await eslint.lintText(code, { filePath });
  const errors = result.messages
    .filter((m) => m.severity === 2)
    .map((m) => `${m.ruleId ?? 'parse'}: ${m.message.split('\n')[0]}`);
  return { code: result.output ?? code, errors };
};
