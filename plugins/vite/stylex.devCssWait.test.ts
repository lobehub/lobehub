// @vitest-environment node
import path from 'node:path';

import type { Plugin } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stylexProxiedDevCssModuleId } from './stylexDevCss';

type Transform = (
  this: unknown,
  code: string,
  id: string,
) => Promise<{ code: string } | null | undefined>;

const source = `import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({ grid: { display: 'grid' } });
export const className = stylex.props(styles.grid).className;
`;

const plainSource = `import * as stylex from '@stylexjs/stylex';
export const merge = (a: unknown) => stylex.props(a as never);
`;

// stylexPlugin reads VITEST at import time and only wraps the dev transform
// outside tests, so load it as the dev server would.
const loadDevTransform = async () => {
  vi.stubEnv('VITEST', 'false');
  vi.stubEnv('NODE_ENV', 'development');
  vi.resetModules();
  const { stylexPlugin } = await import('./stylex');
  const plugins = (stylexPlugin() as Plugin[]).flat();
  const unplugin = plugins.find((item) => item.name === '@stylexjs/unplugin');
  if (!unplugin || typeof unplugin.transform !== 'function') throw new Error('missing transform');
  return unplugin.transform as unknown as Transform;
};

const environment = (mode: string, consumer: string) => ({
  environment: { config: { consumer }, mode },
});

const file = (name: string) => path.resolve(import.meta.dirname, `../../src/${name}.tsx`);

describe('stylexPlugin dev transform', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('makes a dev client module with StyleX rules wait for its CSS', async () => {
    const transform = await loadDevTransform();

    const result = await transform.call(environment('dev', 'client'), source, file('a'));

    expect(result?.code).toContain(`from "${stylexProxiedDevCssModuleId}"`);
    expect(result?.code).toMatch(/await __lobeWaitForStylexCss\(\d+\);\n$/);
  });

  it('leaves build output, server modules and rule-free modules unchanged', async () => {
    const transform = await loadDevTransform();

    const build = await transform.call(environment('build', 'client'), source, file('b'));
    const server = await transform.call(environment('dev', 'server'), source, file('c'));
    const plain = await transform.call(environment('dev', 'client'), plainSource, file('d'));

    for (const result of [build, server, plain]) {
      expect(result?.code).not.toContain('__lobeWaitForStylexCss');
    }
  });
});
