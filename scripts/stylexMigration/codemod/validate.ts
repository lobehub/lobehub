import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

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
const oxlintBin = path.join(repoRoot, 'node_modules/.bin/oxlint');

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

/**
 * Lints with autofix; returns the fixed code and every remaining error. Oxlint
 * has no stdin mode and resolves path-scoped overrides from the file path, so
 * the code is linted in place and the original file is restored afterwards.
 */
export const lintAndFix = async (code: string, filePath: string) => {
  const original = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, code);
  try {
    const { stdout } = spawnSync(oxlintBin, ['--fix', '--format', 'json', filePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const { diagnostics } = JSON.parse(stdout) as {
      diagnostics: { code?: string; message: string; severity: string }[];
    };
    const errors = diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.code ?? 'parse'}: ${d.message.split('\n')[0]}`);
    return { code: readFileSync(filePath, 'utf8'), errors };
  } finally {
    writeFileSync(filePath, original);
  }
};
