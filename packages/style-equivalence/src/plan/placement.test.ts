import { describe, expect, it } from 'vitest';

import type { StyleBinding, StyleElement } from '../extract';
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
});
