import type { Plugin } from 'vite';
import { describe, expect, it } from 'vitest';

import { createStylexEntryCss, stylexAnchorMarker } from './stylexEntryCss';

const chunk = (
  fileName: string,
  importedCss: string[],
  options: Partial<{ imports: string[]; isEntry: boolean }> = {},
) => ({
  fileName,
  imports: options.imports ?? [],
  isEntry: options.isEntry ?? false,
  type: 'chunk' as const,
  viteMetadata: { importedCss: new Set(importedCss) },
});
const asset = (fileName: string, source: string) => ({ fileName, source, type: 'asset' as const });
const toBundle = (...items: Array<{ fileName: string }>) =>
  Object.fromEntries(items.map((item) => [item.fileName, item]));

const anchor = `:root{${stylexAnchorMarker}:1}`;
const rule = '.lh1abcd:not(#\\#){color:red}';

const run = (plugin: Plugin, bundle: Record<string, unknown>) => {
  const hook = plugin.generateBundle as { handler: (...args: unknown[]) => void; order: string };
  hook.handler.call(
    {
      error: (message: string) => {
        throw new Error(message);
      },
    },
    {},
    bundle,
    false,
  );
};

describe('createStylexEntryCss', () => {
  it('locates the anchor before the enforce: pre unplugin reads the target', () => {
    const { plugins } = createStylexEntryCss('lh');
    expect((plugins[0].generateBundle as { order: string }).order).toBe('pre');
    expect((plugins[1].generateBundle as { order: string }).order).toBe('post');
  });

  it('runs only in client environments, not in an SSR build', () => {
    const { plugins } = createStylexEntryCss('lh');
    for (const plugin of plugins) {
      const applies = plugin.applyToEnvironment as (env: unknown) => boolean;
      expect(applies({ config: { consumer: 'client' } })).toBe(true);
      expect(applies({ config: { consumer: 'server' } })).toBe(false);
    }
  });

  it('targets the CSS carrying the stylex.css marker, not a lazy index chunk', () => {
    const { cssInjectionTarget, plugins } = createStylexEntryCss('lh');
    run(
      plugins[0],
      toBundle(
        asset('assets/index-lazy1234.css', '.lazy{}'),
        asset('assets/initial-main_popup-1.css', anchor),
      ),
    );

    expect(cssInjectionTarget('assets/initial-main_popup-1.css')).toBe(true);
    expect(cssInjectionTarget('assets/index-lazy1234.css')).toBe(false);
  });

  it('accepts rules in anchor CSS that loads through a shared initial chunk', () => {
    const { plugins } = createStylexEntryCss('lh');
    const bundle = toBundle(
      chunk('assets/main.js', [], { imports: ['assets/initial.js'], isEntry: true }),
      chunk('assets/initial.js', ['assets/initial.css']),
      asset('assets/initial.css', `${anchor}\n${rule}`),
    );

    expect(() => run(plugins[1], bundle)).not.toThrow();
  });

  it('fails when the rules land in a lazy chunk CSS', () => {
    const { plugins } = createStylexEntryCss('lh');
    const bundle = toBundle(
      chunk('assets/main.js', ['assets/main.css'], { isEntry: true }),
      asset('assets/main.css', anchor),
      asset('assets/TextLayer-1.css', rule),
    );

    expect(() => run(plugins[1], bundle)).toThrow('rules found in assets/TextLayer-1.css');
  });

  it('fails when the anchor CSS only loads with a lazy route', () => {
    const { plugins } = createStylexEntryCss('lh');
    const bundle = toBundle(
      chunk('assets/main.js', [], { isEntry: true }),
      chunk('assets/lazy.js', ['assets/lazy.css']),
      asset('assets/lazy.css', `${anchor}\n${rule}`),
    );

    expect(() => run(plugins[1], bundle)).toThrow('assets/lazy.css does not load with any entry');
  });

  it('fails when no CSS carries the marker', () => {
    const { plugins } = createStylexEntryCss('lh');
    const bundle = toBundle(
      chunk('assets/main.js', ['assets/style.css'], { isEntry: true }),
      asset('assets/style.css', rule),
    );

    expect(() => run(plugins[1], bundle)).toThrow(`no CSS asset carries ${stylexAnchorMarker}`);
  });

  it('ignores builds without StyleX rules', () => {
    const { plugins } = createStylexEntryCss('lh');
    const bundle = toBundle(
      chunk('assets/main.js', [], { isEntry: true }),
      asset('assets/style.css', '.lhs{color:red}'),
    );

    expect(() => run(plugins[1], bundle)).not.toThrow();
  });
});
