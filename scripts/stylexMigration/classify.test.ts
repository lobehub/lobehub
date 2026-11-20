import { describe, expect, it } from 'vitest';

import { classifySelector, classifySource, findLegacyImports } from './classify';

const file = (body: string) => `
import { createStaticStyles, cx, Flexbox } from '@lobehub/ui';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css\`
${body}
  \`,
}));
`;

describe('classifySelector', () => {
  it.each([
    ['@media (max-width: 575px)', 'media'],
    ['@container (max-width: 300px)', 'media'],
    ['&:hover', 'pseudo'],
    ['&::before', 'pseudo'],
    ["&[data-active='true']:hover", 'pseudo'],
    ['&:not(:last-child)', 'pseudo'],
    ['.parent:hover &', 'ancestor'],
    ['& .child', 'descendant'],
    ['&:hover .X-action', 'descendant'],
    ['#lobe-mobile-scroll-container', 'descendant'],
    ['::-webkit-scrollbar', 'descendant'],
    ['li[aria-current="page"]', 'third-party'],
    ['& svg', 'third-party'],
    ['.ant-switch', 'third-party'],
    ['.anticon', 'third-party'],
    ['.ProseMirror p', 'third-party'],
    ['&:hover, & .child', 'descendant'],
    ['from', 'keyframe-step'],
  ])('%s → %s', (selector, kind) => {
    expect(classifySelector(selector)).toBe(kind);
  });
});

describe('classifySource', () => {
  it('puts flat declarations with cssVar and media queries in tier A', () => {
    const report = classifySource(
      file(`
    color: \${cssVar.colorText};
    \${responsive.sm} {
      font-size: 14px;
    }`),
    );
    expect(report).toMatchObject({ blocks: 1, legacyImports: ['createStaticStyles'], tier: 'A' });
  });

  it('puts self pseudo-classes in tier B', () => {
    expect(classifySource(file('&:hover { color: red; }')).tier).toBe('B');
  });

  it('puts descendant coupling in tier C', () => {
    expect(classifySource(file('&:hover .action { opacity: 1; }')).tier).toBe('C');
  });

  it('puts tag and third-party selectors in tier D, even next to simpler ones', () => {
    expect(classifySource(file('&:hover { color: red; }\n    & svg { width: 12px; }')).tier).toBe(
      'D',
    );
  });

  it('ignores selector-looking text outside css blocks', () => {
    const source = `${file('color: red;')}\nconst key = 'builtins.lobe-task.count';`;
    expect(classifySource(source).tier).toBe('A');
  });
});

describe('findLegacyImports', () => {
  it('finds emotion style imports, including aliased and multi-line ones', () => {
    const source = `
import {
  Block,
  createStaticStyles as create,
  keyframes,
} from '@lobehub/ui';
import { css } from 'other-lib';
`;
    expect(findLegacyImports(source)).toEqual(['createStaticStyles', 'keyframes']);
  });

  it('ignores files that only use cx or components', () => {
    expect(findLegacyImports("import { cx, Flexbox } from '@lobehub/ui';")).toEqual([]);
  });
});
