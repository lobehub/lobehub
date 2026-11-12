import { describe, expect, it } from 'vitest';

import { extractFile, type StyleBinding, type StyleElement } from '../extract';
import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { placementPreserved } from './placement';
import { planFile } from './planFile';

const el = (
  tag: string,
  bindings: StyleBinding[],
  extra: Partial<StyleElement> = {},
): StyleElement => ({
  bindings,
  flags: [],
  id: 'Row#0',
  literalProps: {},
  owner: 'Row',
  slots: [],
  tag,
  variables: [],
  ...extra,
});

const cls = (expr: string): StyleBinding => ({ expr, prop: 'className', spread: false });
const spread = (expr: string): StyleBinding => ({ expr, prop: '...', spread: true });
const prop = (name: string, expr: string): StyleBinding => ({ expr, prop: name, spread: false });

describe('placementPreserved', () => {
  it('accepts className rewritten through one stylex.props call', () => {
    expect(
      placementPreserved(
        [el('SkillsIcon', [cls('styles.skillIcon')], { literalProps: { size: 12 } })],
        [
          el('SkillsIcon', [cls('stylex.props(styles.skillIcon).className')], {
            literalProps: { size: 12 },
          }),
        ],
      ),
    ).toBe(true);
  });

  it('treats a stylex.props spread as className', () => {
    expect(
      placementPreserved(
        [el('Card', [cls('styles.chip')])],
        [el('Card', [spread('stylex.props(styles.chip)')])],
      ),
    ).toBe(true);
  });

  describe('variadic sx', () => {
    const properties = { 'styles.a': ['display'], 'styles.b': ['color'] };
    const preserved = (head: string, slots: Record<string, string[]> = properties) =>
      placementPreserved(
        [el('Text', [cls('cx(styles.a, active && styles.b, className)')])],
        [el('Text', [spread(head)])],
        { properties: { base: slots, head: slots } },
      );

    it('reads StyleX slots and a caller className in any argument', () => {
      expect(preserved('sx(styles.a, active && styles.b, className)')).toBe(true);
      expect(preserved('sx([styles.a, active && styles.b], className)')).toBe(true);
    });

    it('does not treat a class from outside StyleX as a StyleX slot', () => {
      expect(preserved('sx(styles.a, active && styles.b, fallback.content)')).toBe(false);
      expect(preserved('sx(styles.a, active && styles.b, className)', {})).toBe(false);
    });

    it('leaves a call carrying an inline style unproven', () => {
      expect(preserved('sx(styles.a, active && styles.b, className, { width: 1 })')).toBe(false);
      expect(preserved('sx(styles.a, active && styles.b, className, {})')).toBe(true);
    });
  });

  it('accepts cx terms with conditions rewritten into one stylex.props call', () => {
    expect(
      placementPreserved(
        [el('Text', [cls('cx(styles.a, active && styles.b)')])],
        [el('Text', [cls('stylex.props(styles.a, active && styles.b).className')])],
      ),
    ).toBe(true);
  });

  it('compares object props key by key', () => {
    expect(
      placementPreserved(
        [
          el('Checkbox', [
            prop(
              'classNames',
              '{ text: cx(styles.textPending, isCompleted && styles.textCompleted), wrapper: styles.itemRow }',
            ),
          ]),
        ],
        [
          el('Checkbox', [
            prop(
              'classNames',
              '{ text: cx(stylex.props(styles.textPending, isCompleted && styles.textCompleted).className), wrapper: stylex.props(styles.itemRow).className }',
            ),
          ]),
        ],
      ),
    ).toBe(true);
  });

  it('rejects separate stylex.props calls joined by hand', () => {
    expect(
      placementPreserved(
        [
          el('Dot', [
            cls(
              "[styles.statusDot, online ? styles.statusDotOnline : undefined].filter(Boolean).join(' ')",
            ),
          ]),
        ],
        [
          el('Dot', [
            cls(
              "[stylex.props(styles.statusDot).className, stylex.props(online ? styles.statusDotOnline : undefined).className].filter(Boolean).join(' ')",
            ),
          ]),
        ],
      ),
    ).toBe(false);
  });

  it('rejects two stylex.props calls inside one cx', () => {
    expect(
      placementPreserved(
        [el('Dot', [cls('cx(styles.a, styles.b)')])],
        [
          el('Dot', [
            cls('cx(stylex.props(styles.a).className, stylex.props(styles.b).className)'),
          ]),
        ],
      ),
    ).toBe(false);
  });

  it('rejects a changed tag', () => {
    expect(
      placementPreserved(
        [el('Icon', [cls('styles.a')])],
        [el('SkillsIcon', [cls('stylex.props(styles.a).className')])],
      ),
    ).toBe(false);
  });

  it('rejects a changed prop', () => {
    expect(
      placementPreserved(
        [el('Menu', [cls('styles.a')])],
        [el('Menu', [prop('rootClassName', 'stylex.props(styles.a).className')])],
      ),
    ).toBe(false);
  });

  it('rejects a changed object key', () => {
    expect(
      placementPreserved(
        [el('Checkbox', [prop('classNames', '{ wrapper: styles.w }')])],
        [el('Checkbox', [prop('classNames', '{ root: stylex.props(styles.w).className }')])],
      ),
    ).toBe(false);
  });

  it('rejects swapped ternary branches', () => {
    expect(
      placementPreserved(
        [el('Row', [cls('active ? styles.on : styles.off')])],
        [el('Row', [cls('stylex.props(active ? styles.off : styles.on).className')])],
      ),
    ).toBe(false);
  });

  it('rejects reordered terms', () => {
    expect(
      placementPreserved(
        [el('Row', [cls('cx(styles.a, styles.b)')])],
        [el('Row', [cls('stylex.props(styles.b, styles.a).className')])],
      ),
    ).toBe(false);
  });

  it('rejects changed literal props', () => {
    expect(
      placementPreserved(
        [el('Icon', [cls('styles.a')], { literalProps: { size: 12 } })],
        [el('Icon', [cls('stylex.props(styles.a).className')], { literalProps: { size: 14 } })],
      ),
    ).toBe(false);
  });

  it('rejects a bare stylex.props object passed where a class string is expected', () => {
    expect(
      placementPreserved(
        [el('Menu', [prop('itemClassName', 'styles.a')])],
        [el('Menu', [prop('itemClassName', 'stylex.props(styles.a)')])],
      ),
    ).toBe(false);
    expect(
      placementPreserved(
        [el('Checkbox', [prop('classNames', '{ text: styles.a }')])],
        [el('Checkbox', [prop('classNames', '{ text: stylex.props(styles.a) }')])],
      ),
    ).toBe(false);
  });

  it('rejects style slots left outside the single stylex.props call', () => {
    expect(
      placementPreserved(
        [el('Row', [cls('cx(styles.a, styles.b)')])],
        [el('Row', [cls('cx(styles.a, stylex.props(styles.b).className)')])],
      ),
    ).toBe(false);
  });

  it('fails closed on shapes it does not understand', () => {
    expect(
      placementPreserved(
        [el('Row', [cls('`${styles.a} extra`')])],
        [el('Row', [cls('`${stylex.props(styles.a).className} extra`')])],
      ),
    ).toBe(false);
  });
});

describe('placementPreserved on replaced elements only', () => {
  const ancestor = (expr: string, tag = 'div') => el(tag, [cls(expr)], { id: 'Row#0' });
  const icon = (expr: string) =>
    el('Icon', [cls(expr)], { id: 'Row#1', literalProps: { size: 14 }, parent: 'Row#0' });

  it('ignores a reordered merge on an intrinsic ancestor', () => {
    expect(
      placementPreserved(
        [ancestor('cx(inspectorTextStyles.root, styles.root)'), icon('styles.icon')],
        [
          ancestor('cx(stylex.props(styles.root).className, inspectorTextStyles.root)'),
          icon('stylex.props(styles.icon).className'),
        ],
      ),
    ).toBe(true);
  });

  it('ignores a changed binding on a layout ancestor', () => {
    expect(
      placementPreserved(
        [ancestor('cx(styles.a, styles.b)', 'Flexbox'), icon('styles.icon')],
        [
          ancestor('stylex.props(styles.b, styles.a).className', 'Flexbox'),
          icon('stylex.props(styles.icon).className'),
        ],
        { layoutComponents: ['Flexbox'] },
      ),
    ).toBe(true);
  });

  it('still compares a component ancestor that is not a layout component', () => {
    expect(
      placementPreserved(
        [ancestor('cx(styles.a, styles.b)', 'Flexbox'), icon('styles.icon')],
        [
          ancestor('stylex.props(styles.b, styles.a).className', 'Flexbox'),
          icon('stylex.props(styles.icon).className'),
        ],
      ),
    ).toBe(false);
  });

  it('rejects a changed intrinsic ancestor tag', () => {
    expect(
      placementPreserved(
        [ancestor('styles.root'), icon('styles.icon')],
        [
          ancestor('stylex.props(styles.root).className', 'span'),
          icon('stylex.props(styles.icon).className'),
        ],
      ),
    ).toBe(false);
  });

  it('rejects chains of different length', () => {
    expect(
      placementPreserved(
        [ancestor('styles.root'), icon('styles.icon')],
        [icon('stylex.props(styles.icon).className')],
      ),
    ).toBe(false);
  });

  it('still compares an intrinsic element that passes a style through a neutral prop', () => {
    expect(
      placementPreserved(
        [el('div', [prop('style', 'styles.a')])],
        [el('div', [prop('style', 'stylex.props(styles.b).style')])],
      ),
    ).toBe(false);
  });
});

describe('placementPreserved on hand-joined classes', () => {
  const disjoint = {
    base: {
      'styles.activated': ['color', 'background'],
      'styles.badge': ['display', 'padding-inline', 'border-radius'],
    },
    head: {
      'styles.activated': ['color', 'background-color', 'background-image'],
      'styles.badge': ['display', 'padding-inline', 'border-radius'],
    },
  };
  const badge = (expr: string) => [el('Badge', [cls(expr)])];

  it('accepts an array join of separate stylex.props calls whose slots do not overlap', () => {
    expect(
      placementPreserved(
        badge("[styles.badge, styles.activated].join(' ')"),
        badge(
          "[stylex.props(styles.badge).className, stylex.props(styles.activated).className].join(' ')",
        ),
        { properties: disjoint },
      ),
    ).toBe(true);
  });

  it('accepts a join on one side and one merge with the same ordered terms on the other', () => {
    expect(
      placementPreserved(
        badge("[styles.badge, styles.activated].join(' ')"),
        badge('stylex.props(styles.badge, styles.activated).className'),
        { properties: disjoint },
      ),
    ).toBe(true);
  });

  it('accepts a template literal join with a condition in one source', () => {
    const properties = {
      'styles.code': ['margin-inline-start', 'font-family', 'font-size'],
      'styles.error': ['color'],
      'styles.success': ['color'],
    };
    expect(
      placementPreserved(
        badge('`${styles.code} ${success ? styles.success : styles.error}`'),
        badge(
          '`${stylex.props(styles.code).className} ${stylex.props(success ? styles.success : styles.error).className}`',
        ),
        { properties: { base: properties, head: properties } },
      ),
    ).toBe(true);
  });

  it('accepts cx over the className of separate stylex.props calls', () => {
    expect(
      placementPreserved(
        badge('cx(styles.badge, styles.activated)'),
        badge('cx(stylex.props(styles.badge).className, stylex.props(styles.activated).className)'),
        { properties: disjoint },
      ),
    ).toBe(true);
  });

  it('rejects joined sources that set the same property in any branch', () => {
    const properties = {
      'styles.statusDot': ['width', 'border-width', 'border-style', 'border-color'],
      'styles.statusDotOnline': ['border-style', 'background-color'],
    };
    const base = badge(
      "[styles.statusDot, online ? styles.statusDotOnline : undefined].filter(Boolean).join(' ')",
    );
    const head = badge(
      "[stylex.props(styles.statusDot).className, online ? stylex.props(styles.statusDotOnline).className : undefined].filter(Boolean).join(' ')",
    );
    expect(
      placementPreserved(base, head, { properties: { base: properties, head: properties } }),
    ).toBe(false);
    const apart = { ...properties, 'styles.statusDotOnline': ['background-color'] };
    expect(placementPreserved(base, head, { properties: { base: apart, head: apart } })).toBe(true);
  });

  it('rejects joined sources that overlap only through a shorthand', () => {
    const properties = { 'styles.a': ['padding-inline'], 'styles.b': ['padding-left'] };
    expect(
      placementPreserved(
        badge("[styles.a, styles.b].join(' ')"),
        badge("[stylex.props(styles.a).className, stylex.props(styles.b).className].join(' ')"),
        { properties: { base: properties, head: properties } },
      ),
    ).toBe(false);
  });

  it('rejects a join when one side does not know what a slot sets', () => {
    expect(
      placementPreserved(
        badge("[styles.badge, styles.activated].join(' ')"),
        badge(
          "[stylex.props(styles.badge).className, stylex.props(styles.activated).className].join(' ')",
        ),
        { properties: { base: disjoint.base, head: { 'styles.badge': ['display'] } } },
      ),
    ).toBe(false);
  });

  it('rejects joins that do not separate the classes with whitespace', () => {
    const properties = { base: disjoint.base, head: disjoint.head };
    expect(
      placementPreserved(
        badge('`${styles.badge}${styles.activated}`'),
        badge(
          '`${stylex.props(styles.badge).className}${stylex.props(styles.activated).className}`',
        ),
        { properties },
      ),
    ).toBe(false);
    expect(
      placementPreserved(
        badge("[styles.badge, styles.activated].join('')"),
        badge(
          "[stylex.props(styles.badge).className, stylex.props(styles.activated).className].join('')",
        ),
        { properties },
      ),
    ).toBe(false);
  });

  it('rejects swapped sources even when they do not overlap', () => {
    expect(
      placementPreserved(
        badge("[styles.badge, styles.activated].join(' ')"),
        badge(
          "[stylex.props(styles.activated).className, stylex.props(styles.badge).className].join(' ')",
        ),
        { properties: disjoint },
      ),
    ).toBe(false);
  });

  it('rejects a joined source that leaves a slot outside its stylex.props call', () => {
    expect(
      placementPreserved(
        badge("[cx(styles.badge, styles.activated)].join(' ')"),
        badge("[cx(stylex.props(styles.badge).className, styles.activated)].join(' ')"),
        { properties: disjoint },
      ),
    ).toBe(false);
  });
});

describe('planFile placement evidence', () => {
  it('drops placement flags and records evidence for an identical chain', () => {
    const base = el('SkillsIcon', [cls('styles.skillIcon')], { slots: ['styles.skillIcon'] });
    const head = el('SkillsIcon', [cls('stylex.props(styles.skillIcon).className')], {
      slots: ['styles.skillIcon'],
    });
    const extraction = (element: StyleElement) => ({
      elements: [element],
      file: 'a.tsx',
      gaps: [],
      outsideReferences: [],
      prelude: '',
      rules: [],
      styleSymbols: ['styles'],
    });
    const [plan] = planFile('a.tsx', extraction(base), extraction(head), {
      layoutComponents: [],
    }).cases;
    expect(plan.flags).toEqual([]);
    expect(plan.evidence).toEqual(['PLACEMENT_PRESERVED']);
  });

  it('drops the placement flag when only an intrinsic ancestor of the replaced icon changed', () => {
    const root = (expr: string) =>
      el('div', [cls(expr)], { id: 'List#0', owner: 'List', slots: ['styles.root'] });
    const icon = (expr: string) =>
      el('Icon', [cls(expr)], {
        id: 'List#1',
        literalProps: { size: 14 },
        owner: 'List',
        parent: 'List#0',
        slots: ['styles.icon'],
      });
    const extraction = (elements: StyleElement[]) => ({
      elements,
      file: 'a.tsx',
      gaps: [],
      outsideReferences: [],
      prelude: '',
      rules: [],
      styleSymbols: ['styles'],
    });
    const [, plan] = planFile(
      'a.tsx',
      extraction([root('cx(inspectorTextStyles.root, styles.root)'), icon('styles.icon')]),
      extraction([
        root('cx(stylex.props(styles.root).className, inspectorTextStyles.root)'),
        icon('stylex.props(styles.icon).className'),
      ]),
      { layoutComponents: [] },
    ).cases;
    expect(plan.flags).toEqual([]);
    expect(plan.evidence).toEqual(['PLACEMENT_PRESERVED']);
  });

  it('proves a hand-joined class on a replaced component from the extracted declarations', () => {
    const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: [] };
    const base = (online: string) =>
      extractFile(
        `import { createStaticStyles } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({
  badge: css\`display: inline-flex; padding-inline: 8px;\`,
  activated: css\`${online}\`,
}));
export const A = () => <Badge className={[styles.badge, styles.activated].join(' ')} />;
`,
        'a.tsx',
        options,
      );
    const head = (online: string) =>
      extractFile(
        `import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({
  badge: { display: 'inline-flex', paddingInline: '8px' },
  activated: { ${online} },
});
export const A = () => <Badge className={[stylex.props(styles.badge).className, stylex.props(styles.activated).className].join(' ')} />;
`,
        'a.tsx',
        options,
      );
    const plan = (left: string, right: string) =>
      planFile('a.tsx', base(left), head(right), { layoutComponents: [] }).cases[0];
    expect(plan('color: green;', "color: 'green'").flags).toEqual([]);
    expect(plan('padding-left: 4px;', "paddingLeft: '4px'").flags).toEqual([
      'PLACEMENT_SUBSTITUTED',
    ]);
  });
});
