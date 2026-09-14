import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { build, resolveConfig } from 'vite';
import { expect, it, vi } from 'vitest';

it.each(['main', 'preload'])('resolves Cloud Sentry imports from Desktop in %s', async (target) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'desktop-sentry-'));
  vi.stubEnv('MAIN_HASH', '0'.repeat(64));
  try {
    const desktop = path.join(directory, 'desktop');
    const cloud = path.join(directory, 'cloud');
    for (const root of [desktop, cloud]) {
      const pkg = path.join(root, 'node_modules/@sentry/electron');
      await mkdir(pkg, { recursive: true });
      await writeFile(
        path.join(pkg, 'package.json'),
        JSON.stringify({ exports: { './main': './index.js' }, name: '@sentry/electron' }),
      );
      await writeFile(path.join(pkg, 'index.js'), `export default ${JSON.stringify(root)};`);
    }
    const entry = path.join(cloud, 'entry.js');
    await writeFile(entry, "export { default } from '@sentry/electron/main';");
    const config = await resolveConfig(
      { configFile: path.resolve(`vite.${target}.config.ts`) },
      'build',
      'development',
    );
    const result = await build({
      build: { lib: { entry, formats: ['es'] }, minify: false, write: false },
      configFile: false,
      logLevel: 'silent',
      resolve: config.resolve,
      root: desktop,
    });
    const outputs = Array.isArray(result) ? result : [result];
    const code = outputs
      .flatMap((output) => ('output' in output ? output.output : []))
      .filter((output) => output.type === 'chunk')
      .map((output) => output.code)
      .join('\n');
    expect(code).toContain(desktop);
    expect(code).not.toContain(cloud);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { force: true, recursive: true });
  }
});
