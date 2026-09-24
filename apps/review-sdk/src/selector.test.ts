import { describe, expect, it } from 'vitest';

import { elementTextOf, selectorFor, type SelectorNode } from './selector';

function node(
  tagName: string,
  attributes: Record<string, string> = {},
  children: SelectorNode[] = [],
): SelectorNode {
  const self: SelectorNode = {
    tagName: tagName.toUpperCase(),
    id: attributes.id ?? '',
    parentElement: null,
    getAttribute: (name) => attributes[name] ?? null,
    children,
  };
  for (const child of children) child.parentElement = self;
  return self;
}

describe('selectorFor', () => {
  it('stops at the nearest element with a test id', () => {
    const button = node('button');
    node('body', {}, [
      node('main', {}, [
        node('section', { 'data-testid': 'run-error' }, [node('div', {}, [button])]),
      ]),
    ]);
    expect(selectorFor(button)).toBe('[data-testid="run-error"] > div > button');
  });

  it('uses a readable id but skips generated ones', () => {
    const cell = node('span');
    node('body', {}, [
      node('div', { id: 'main-content' }, [node('div', { id: 'rc-tabs-1a2b3c4d' }, [cell])]),
    ]);
    expect(selectorFor(cell)).toBe('#main-content > div > span');
  });

  it('disambiguates siblings with nth-of-type', () => {
    const second = node('li');
    node('body', {}, [node('ul', {}, [node('li'), second, node('li')])]);
    expect(selectorFor(second)).toBe('ul > li:nth-of-type(2)');
  });

  it('prefers an aria-label over position and escapes quotes', () => {
    const icon = node('button', { 'aria-label': '删除 "草稿"' });
    node('body', {}, [node('div', {}, [icon, node('button')])]);
    expect(selectorFor(icon)).toBe('div > button[aria-label="删除 \\"草稿\\""]');
  });
});

describe('elementTextOf', () => {
  it('collapses whitespace and truncates', () => {
    expect(elementTextOf('  失败原因\n\n  CUDA OOM  ')).toBe('失败原因 CUDA OOM');
    expect(elementTextOf('x'.repeat(10), 5)).toBe('xxxx…');
    expect(elementTextOf(null)).toBe('');
  });
});
