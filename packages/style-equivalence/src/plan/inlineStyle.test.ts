import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { generateModule } from '../generate/module';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: [] };

const baseWith = (
  attributes = 'className={styles.divider} style={{ left: `${view.ratio * 100}%` }}',
) => `import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({ divider: css\`width: 4px;\` }));

export const Split = ({ handlers, view }) => (
  <div ${attributes} />
);
`;

const base = baseWith();

const headWith = (call: string, spread = '') => `import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

const styles = stylex.create({ divider: { width: '4px' } });

export const Split = ({ handlers, view }) => <div ${spread}{...${call}} />;
`;

const head = (style = '{ left: `${view.ratio * 100}%` }', spread = '') =>
  headWith(`sx([styles.divider], undefined, ${style})`, spread);

const plan = (after: string, before = base) => {
  const pair = {
    base: extractFile(before, 'a.tsx', options),
    head: extractFile(after, 'a.tsx', options),
  };
  return { pair, plan: planFile('a.tsx', pair.base, pair.head, { layoutComponents: [] }) };
};

describe('an inline style moved from the style prop into sx', () => {
  it('renders neither side with it when the expression is the same', () => {
    const { pair, plan: result } = plan(head());
    const [entry] = result.cases;
    expect(entry.flags).toEqual([]);
    expect(entry.variables).toEqual([]);
    expect(entry.inlineStyles?.head).toEqual([
      { binding: 0, index: 0, without: 'sx([styles.divider], undefined, undefined)' },
    ]);
    const module = generateModule(pair.head, result, 'head', { layoutComponents: [] });
    expect(module).not.toContain('view.ratio');
  });

  it('keeps the variable when the style expression changed', () => {
    const [entry] = plan(head('{ left: `${view.ratio * 50}%` }')).plan.cases;
    expect(entry.inlineStyles).toBeUndefined();
    expect(entry.flags).toContain('VARIABLE_UNMODELED');
  });

  it('shares the style next to a spread whose order relative to it did not change', () => {
    const before = baseWith(
      '{...handlers} className={styles.divider} style={{ left: `${view.ratio * 100}%` }}',
    );
    const [entry] = plan(head(undefined, '{...handlers} '), before).plan.cases;
    expect(entry.inlineStyles?.head).toHaveLength(1);
    expect(entry.flags).toEqual([]);
  });

  it('flags a style that moved from before a spread to after it', () => {
    const before = baseWith(
      'className={styles.divider} style={{ left: `${view.ratio * 100}%` }} {...handlers}',
    );
    const [entry] = plan(head(undefined, '{...handlers} '), before).plan.cases;
    expect(entry.inlineStyles?.head).toHaveLength(1);
    expect(entry.flags).toEqual(['INLINE_STYLE_SPREAD_ORDER']);
  });

  it('shares a style that differs only by a trailing comma and line breaks', () => {
    const [entry] = plan(head('{\n  left: `${view.ratio * 100}%`,\n}')).plan.cases;
    expect(entry.inlineStyles?.head).toHaveLength(1);
    expect(entry.flags).toEqual([]);
  });

  it('finds the style in a variadic sx call, whatever its position', () => {
    const style = '{ left: `${view.ratio * 100}%` }';
    const [entry] = plan(headWith(`sx(styles.divider, ${style}, 'caller')`)).plan.cases;
    expect(entry.flags).toEqual([]);
    expect(entry.inlineStyles?.head).toEqual([
      { binding: 0, index: 0, without: "sx(styles.divider, undefined, 'caller')" },
    ]);
  });
});
