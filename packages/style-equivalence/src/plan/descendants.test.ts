import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: ['Flexbox'] };

const base = (summary = '<summary>Raw</summary>', rule = 'summary { cursor: pointer; }') => `
import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  rawDetails: css\`
    font-size: 12px;
    ${rule}
  \`,
}));

export const Render = () => (
  <details className={styles.rawDetails}>
    ${summary}
    <Highlighter language="json">{json}</Highlighter>
  </details>
);
`;

const head = (summary = '<summary {...stylex.props(styles.rawSummary)}>Raw</summary>') => `
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  rawDetails: { fontSize: '12px' },
  rawSummary: { cursor: 'pointer' },
});

export const Render = () => (
  <details {...stylex.props(styles.rawDetails)}>
    ${summary}
    <Highlighter language="json">{json}</Highlighter>
  </details>
);
`;

const plan = (before: string, after: string) =>
  planFile('a.tsx', extractFile(before, 'a.tsx', options), extractFile(after, 'a.tsx', options), {
    layoutComponents: ['Flexbox'],
  });

describe('a new element that replaces a descendant selector', () => {
  it('records the direct children and subtree tags of a styled element', () => {
    const extraction = extractFile(base(), 'a.tsx', options);
    expect(extraction.elements[0].children).toEqual(['Render#0/0', 'Render#0/1']);
    expect(extraction.elements[0].subtreeTags).toEqual({ summary: 1 });
    expect(extraction.plain?.map(({ id, tag }) => [id, tag])).toEqual([
      ['Render#0/0', 'summary'],
      ['Render#0/1', 'Highlighter'],
    ]);
  });

  it('pairs the styled child with the plain child the parent rule targeted and clears the parent', () => {
    const result = plan(base(), head());
    expect(result.unpaired).toEqual([]);
    expect(result.cases.map((entry) => [entry.key, entry.flags, entry.evidence])).toEqual([
      ['a.tsx|Render#0', [], ['DESCENDANT_RENDERED']],
      ['a.tsx|Render#0/0', [], ['DESCENDANT_REPLACED']],
    ]);
    expect(result.cases[1].elementIds).toEqual({ base: 'Render#0/0', head: 'Render#1' });
  });

  it('pairs a child that a universal child rule targeted', () => {
    const result = plan(base(undefined, '> * { cursor: pointer; }'), head());
    expect(result.unpaired).toEqual([]);
    expect(result.cases[1].evidence).toEqual(['DESCENDANT_REPLACED']);
  });

  it('leaves the child unpaired when no parent rule targets it', () => {
    const result = plan(base(undefined, 'span { cursor: pointer; }'), head());
    expect(result.unpaired).toEqual([{ elementId: 'Render#1', side: 'head' }]);
    expect(result.cases[0].flags).toEqual(['INNER_TARGET']);
  });

  it('leaves the child unpaired when its attributes differ', () => {
    const result = plan(
      base('<summary title="a">Raw</summary>'),
      head('<summary title="b" {...stylex.props(styles.rawSummary)}>Raw</summary>'),
    );
    expect(result.unpaired).toEqual([{ elementId: 'Render#1', side: 'head' }]);
  });

  it('leaves the child unpaired when it carries a class the tool cannot read', () => {
    const result = plan(base('<summary className={extra}>Raw</summary>'), head());
    expect(result.unpaired).toEqual([{ elementId: 'Render#1', side: 'head' }]);
  });

  it('keeps the parent flagged when the rule also reaches a deeper element of that tag', () => {
    const result = plan(
      base('<summary>Raw</summary><div><summary>Nested</summary></div>'),
      head(
        '<summary {...stylex.props(styles.rawSummary)}>Raw</summary><div><summary>Nested</summary></div>',
      ),
    );
    expect(result.cases[0].flags).toEqual(['INNER_TARGET']);
    expect(result.cases[1].flags).toEqual([]);
  });
});
