import { describe, expect, it } from 'vitest';

import type { FileExtraction, StyleElement, VariableUse } from '../extract';
import { pairwiseCombos } from './combos';
import { planFile } from './planFile';

const element = (
  id: string,
  tag: string,
  slots: string[],
  variables: VariableUse[] = [],
  extra: Partial<StyleElement> = {},
): StyleElement => ({
  bindings: [{ expr: 'x', prop: 'className', spread: false }],
  flags: [],
  id,
  literalProps: {},
  owner: id.split('#')[0],
  slots,
  tag,
  variables,
  ...extra,
});

const extraction = (elements: StyleElement[]): FileExtraction => ({
  elements,
  file: 'a.tsx',
  gaps: [],
  outsideReferences: [],
  prelude: '',
  rules: [],
  styleSymbols: ['styles'],
});

const config = { layoutComponents: ['Flexbox'] };

describe('planFile pairing', () => {
  it('keeps later elements paired when one side gains an element in the middle', () => {
    const plan = planFile(
      'a.tsx',
      extraction([
        element('A#0', 'div', ['styles.root']),
        element('A#1', 'span', ['styles.label']),
        element('A#2', 'span', ['styles.hint']),
      ]),
      extraction([
        element('A#0', 'div', ['styles.root']),
        element('A#1', 'button', ['styles.action']),
        element('A#2', 'span', ['styles.label']),
        element('A#3', 'span', ['styles.hint']),
      ]),
      config,
    );
    expect(plan.cases.map((entry) => [entry.elementIds.base, entry.elementIds.head])).toEqual([
      ['A#0', 'A#0'],
      ['A#1', 'A#2'],
      ['A#2', 'A#3'],
    ]);
    expect(plan.unpaired).toEqual([{ elementId: 'A#1', side: 'head' }]);
  });

  it('marks every element of an owner missing on the other side as unpaired', () => {
    const plan = planFile(
      'a.tsx',
      extraction([element('Old#0', 'div', ['styles.a'])]),
      extraction([element('New#0', 'div', ['styles.a'])]),
      config,
    );
    expect(plan.cases).toEqual([]);
    expect(plan.unpaired).toEqual([
      { elementId: 'Old#0', side: 'base' },
      { elementId: 'New#0', side: 'head' },
    ]);
  });
});

describe('planFile conditions and flags', () => {
  it('flags a condition that only one side uses and still enumerates it', () => {
    const [entry] = planFile(
      'a.tsx',
      extraction([element('L#0', 'Flexbox', ['styles.label'])]),
      extraction([
        element(
          'L#0',
          'Flexbox',
          ['styles.label', 'styles.labelMuted'],
          [{ kind: 'boolean', name: 'muted' }],
        ),
      ]),
      config,
    ).cases;
    expect(entry.flags).toEqual(['ASYMMETRIC_CONDITION']);
    expect(entry.combos).toEqual([{ muted: false }, { muted: true }]);
  });

  it('enumerates modeled kinds, drops pass-through props and flags unmodeled ones', () => {
    const variables: VariableUse[] = [
      { kind: 'call', name: 'isActive' },
      { kind: 'member', name: 'item' },
      { kind: 'unknown', name: 'size' },
      { kind: 'unknown', name: 'className' },
    ];
    const [entry] = planFile(
      'a.tsx',
      extraction([element('A#0', 'div', ['styles.a'], variables)]),
      extraction([element('A#0', 'div', ['styles.a'], variables)]),
      config,
    ).cases;
    expect(entry.variables.map((variable) => variable.name)).toEqual(['isActive', 'item']);
    expect(entry.combos).toHaveLength(4);
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('merges the kinds a variable has along the chain', () => {
    const chain = () =>
      extraction([
        element('A#0', 'div', ['styles.row'], [{ kind: 'boolean', name: 'item' }]),
        element('A#1', 'span', ['styles.label'], [{ kind: 'member', name: 'item' }], {
          parent: 'A#0',
        }),
      ]);
    const inner = planFile('a.tsx', chain(), chain(), config).cases[1];
    expect(inner.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('flags substituted tags, neutral props and changed tags along the chain', () => {
    const [outer, inner] = planFile(
      'a.tsx',
      extraction([
        element('A#0', 'SortableList.Item', ['styles.item']),
        element('A#1', 'div', ['styles.dot'], [], { parent: 'A#0' }),
      ]),
      extraction([
        element('A#0', 'SortableList.Item', ['styles.item'], [], {
          bindings: [{ expr: 'x', prop: 'itemClassName', spread: false }],
        }),
        element('A#1', 'span', ['styles.dot'], [], { parent: 'A#0' }),
      ]),
      config,
    ).cases;
    expect(outer.flags).toEqual(['PLACEMENT_NEUTRAL_PROP', 'PLACEMENT_SUBSTITUTED']);
    expect(inner.flags).toEqual(['PLACEMENT_NEUTRAL_PROP', 'PLACEMENT_SUBSTITUTED', 'TAG_CHANGED']);
  });
});

describe('pairwiseCombos', () => {
  it('covers every value pair of six booleans in far fewer than 64 combos', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const combos = pairwiseCombos(names);
    expect(combos.length).toBeLessThanOrEqual(12);
    for (const [i, x] of names.entries())
      for (const y of names.slice(i + 1))
        for (const vx of [false, true])
          for (const vy of [false, true])
            expect(combos.some((combo) => combo[x] === vx && combo[y] === vy)).toBe(true);
  });
});
