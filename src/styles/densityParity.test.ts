import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DENSITY_TOKENS } from './density';

const readTokens = (file: string) => {
  const source = readFileSync(join(__dirname, file), 'utf8');
  const tokens: Record<string, number> = {};
  for (const [, name, value] of source.matchAll(/'--lobe-density-([a-z-]+)': '(\d+)px'/g)) {
    tokens[name.replaceAll(/-([a-z])/g, (_, char: string) => char.toUpperCase())] = Number(value);
  }
  return tokens;
};

describe('density CSS variables', () => {
  it('declares loose defaults that match DENSITY_TOKENS.loose', () => {
    const tokens = readTokens('density.stylex.ts');

    expect(Object.keys(tokens).length).toBeGreaterThan(0);
    expect(DENSITY_TOKENS.loose).toMatchObject(tokens);
  });

  it('overrides every variable in the compact theme with DENSITY_TOKENS.compact', () => {
    const loose = readTokens('density.stylex.ts');
    const compact = readTokens('densityTheme.ts');

    expect(Object.keys(compact).sort()).toEqual(Object.keys(loose).sort());
    expect(DENSITY_TOKENS.compact).toMatchObject(compact);
  });
});
