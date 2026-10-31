import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { HIGHLIGHT_REGISTRY } from './highlights';

describe('HighlightStyle.css', () => {
  const css = readFileSync(path.resolve(__dirname, 'HighlightStyle.css'), 'utf8');

  it.each(Object.values(HIGHLIGHT_REGISTRY))('styles the %s registry', (name) => {
    expect(css).toContain(`::highlight(${name})`);
  });
});
