import { describe, expect, it } from 'vitest';

import { isShikiSource } from './shikiSource';

describe('isShikiSource', () => {
  it.each([
    ['@shikijs/langs', undefined],
    ['@shikijs/langs/cpp', undefined],
    ['@shikijs/themes', undefined],
    ['shiki/wasm', undefined],
    ['/repo/node_modules/@shikijs/langs/dist/cpp.mjs', undefined],
    ['/repo/node_modules/@shikijs/themes/dist/github-dark.mjs', undefined],
    ['./langs-bundle-full-xQVO1Cek.mjs', '/repo/node_modules/shiki/dist/index.mjs'],
    ['./themes.mjs', '/repo/node_modules/shiki/dist/index.mjs'],
    ['./wasm-inlined.mjs', '/repo/node_modules/@shikijs/engine-oniguruma/dist/index.mjs'],
  ] as const)('stubs %s from %s', (source, importer) => {
    expect(isShikiSource(source, importer)).toBe(true);
  });

  it.each([
    ['shiki', undefined],
    ['@shikijs/transformers', undefined],
    ['@shikijs/core', undefined],
    ['@lobehub/ui', undefined],
    ['/repo/src/features/Verify/Acceptance/index.tsx', undefined],
    ['./bundle-full.mjs', '/repo/node_modules/shiki/dist/index.mjs'],
  ] as const)('leaves %s from %s', (source, importer) => {
    expect(isShikiSource(source, importer)).toBe(false);
  });
});
