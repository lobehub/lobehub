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
  it('renders both sides with the same unset mask when the expression is the same', () => {
    const { pair, plan: result } = plan(head());
    const [entry] = result.cases;
    expect(entry.flags).toEqual([]);
    expect(entry.variables).toEqual([]);
    expect(entry.inlineStyles?.head).toEqual([
      { binding: 0, index: 0, without: "sx([styles.divider], undefined, { left: 'unset' })" },
    ]);
    expect(entry.inlineMasks?.base).toEqual([{ index: 0, style: "{ left: 'unset' }" }]);
    const headModule = generateModule(pair.head, result, 'head', { layoutComponents: [] });
    expect(headModule).not.toContain('view.ratio');
    const baseModule = generateModule(pair.base, result, 'base', { layoutComponents: [] });
    expect(baseModule).toContain("style={({ left: 'unset' })}");
    expect(baseModule).not.toContain('view.ratio');
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
      { binding: 0, index: 0, without: "sx(styles.divider, { left: 'unset' }, 'caller')" },
    ]);
  });
});

const limitBase = (style: string) => `import { createStaticStyles } from '@lobehub/ui';

import { LIMIT, widthOf } from './layout';

const styles = createStaticStyles(({ css }) => ({ column: css\`max-width: 1280px;\` }));

export const Column = ({ size, tab }) => <div className={styles.column} style={${style}} />;
`;

const limitHead = (style: string) => `import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

import { LIMIT, widthOf } from './layout';

const styles = stylex.create({ column: { width: '100%' } });

export const Column = ({ size, tab }) => <div {...sx([styles.column], undefined, ${style})} />;
`;

const limitCase = (style: string) => plan(limitHead(style), limitBase(style)).plan.cases[0];

describe('a shared inline style that overrides the class on both sides', () => {
  it('masks a module constant without flagging it', () => {
    const entry = limitCase('{ maxWidth: LIMIT }');
    expect(entry.flags).toEqual([]);
    expect(entry.inlineMasks?.base).toEqual([{ index: 0, style: "{ maxWidth: 'unset' }" }]);
  });

  it('masks literals, member reads of constants and arithmetic without flagging them', () => {
    const entry = limitCase("{ maxWidth: LIMIT.wide * 2, minWidth: 'min-content', margin: 0 }");
    expect(entry.flags).toEqual([]);
    expect(entry.inlineMasks?.base).toEqual([
      { index: 0, style: "{ maxWidth: 'unset', minWidth: 'unset', margin: 'unset' }" },
    ]);
  });

  it('compares a call that may return nothing both with and without the mask', () => {
    const entry = limitCase("{ maxWidth: tab === 'flow' ? 1500 : widthOf(tab) }");
    expect(entry.flags).toEqual([]);
    expect(entry.combos).toEqual([{ __inlineStyle: true }, { __inlineStyle: false }]);
    expect(entry.inlineMasks?.base).toEqual([
      { index: 0, style: "__v.__inlineStyle ? { maxWidth: 'unset' } : undefined" },
    ]);
    expect(entry.inlineStyles?.head?.[0].without).toBe(
      "sx([styles.column], undefined, __v.__inlineStyle ? { maxWidth: 'unset' } : undefined)",
    );
  });

  it('toggles the mask for a prop that may be absent', () => {
    expect(limitCase('{ width: size }').combos).toEqual([
      { __inlineStyle: true },
      { __inlineStyle: false },
    ]);
  });

  it('toggles the mask for a value that can short-circuit to nothing', () => {
    expect(limitCase('{ maxWidth: LIMIT ?? undefined }').combos).toHaveLength(2);
  });

  it('renders a certain mask in every combination without toggling it', () => {
    expect(limitCase('{ maxWidth: LIMIT }').combos).toEqual([{}]);
  });

  it('drops a style it cannot name every property of, as before', () => {
    const entry = limitCase('{ ...LIMIT, maxWidth: 1 }');
    expect(entry.inlineMasks).toBeUndefined();
    expect(entry.inlineStyles?.head).toEqual([
      { binding: 0, index: 0, without: 'sx([styles.column], undefined, undefined)' },
    ]);
  });
});
