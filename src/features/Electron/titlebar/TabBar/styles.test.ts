import { describe, expect, it } from 'vitest';

// Read as source rather than exercised through a rendered tab: the rules under test only
// exist as `[data-tier]` selectors in a static stylesheet, and a happy-dom render
// reproduces neither the attribute cascade nor the thing that makes them wrong — the tier
// landing a whole spring ahead of the width it describes.
import source from './styles.ts?raw';

const ruleBody = (selector: string): string => {
  const start = source.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);

  const open = source.indexOf('{', start);
  let depth = 0;

  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }

  throw new Error(`unbalanced rule: ${selector}`);
};

describe('icon tier', () => {
  const body = ruleBody("&[data-tier='icon']");

  // Geometry belongs to the springs in TabItem, which arrive with the width. Anything here
  // lands on the tier flip instead, a whole spring earlier.
  it('moves nothing', () => {
    expect(body).not.toMatch(/padding-inline|justify-content|gap\s*:|width\s*:|flex\s*:/);
  });

  it('fades the title rather than collapsing it', () => {
    expect(body).toMatch(/opacity:\s*0/);
  });
});

describe('close button reveal', () => {
  const selectorList = (() => {
    const end = source.indexOf('[data-tab-close] {');
    const open = source.lastIndexOf('{', end - 1);
    const start = source.lastIndexOf('*/', open) + 2;
    return source.slice(start, open);
  })();

  // A lone tab has nowhere to close to, so hovering it must not reveal the button.
  it('only reveals the button on closable tabs', () => {
    const selectors = selectorList
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean);

    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector).toContain('[data-closable]');
  });
});
