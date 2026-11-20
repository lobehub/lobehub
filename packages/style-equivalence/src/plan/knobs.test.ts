import { describe, expect, it } from 'vitest';

import type { FileExtraction, StyleBinding, StyleElement, VariableUse } from '../extract';
import { bindKnobs } from './knobs';
import { planFile } from './planFile';

const cls = (expr: string): StyleBinding => ({ expr, prop: 'className', spread: false });
const spread = (expr: string): StyleBinding => ({ expr, prop: '...', spread: true });

const el = (
  id: string,
  tag: string,
  binding: StyleBinding,
  variables: VariableUse[] = [],
  extra: Partial<StyleElement> = {},
): StyleElement => ({
  bindings: [binding],
  flags: [],
  id,
  literalProps: {},
  owner: id.split('#')[0],
  slots: [],
  tag,
  variables,
  ...extra,
});

const extraction = (
  elements: StyleElement[],
  slotProperties?: Record<string, string[]>,
): FileExtraction => ({
  elements,
  file: 'a.tsx',
  gaps: [],
  outsideReferences: [],
  prelude: '',
  rules: [],
  slotProperties,
  styleSymbols: ['styles'],
});

const config = { layoutComponents: ['Flexbox'] };
const state: VariableUse[] = [{ kind: 'unknown', name: 'state' }];
const variant: VariableUse[] = [{ kind: 'unknown', name: 'variant' }];
const STATUS = "state.status === 'succeeded' || state.status === 'partial'";
const RUNNING = "state.status !== 'running'";
const CHIP_ARGS = `styles.chip, ${STATUS} ? styles.succeeded : ${RUNNING} && styles.failed`;

const single = (base: StyleElement, head: StyleElement) =>
  planFile('a.tsx', extraction([base]), extraction([head]), config).cases[0];

describe('planFile condition knobs', () => {
  it('models each condition of an otherwise unmodeled chain as a knob', () => {
    const entry = single(
      el('Chip#0', 'span', cls(`cx(${CHIP_ARGS})`), state),
      el('Chip#0', 'span', spread(`stylex.props(${CHIP_ARGS})`), state),
    );
    expect(entry.flags).toEqual([]);
    expect(entry.evidence).toEqual(['CONDITION_KNOBS']);
    expect(entry.knobs).toEqual([STATUS, RUNNING]);
    expect(entry.variables).toEqual([]);
    expect(entry.combos).toEqual([
      { [RUNNING]: false, [STATUS]: false },
      { [RUNNING]: false, [STATUS]: true },
      { [RUNNING]: true, [STATUS]: false },
      { [RUNNING]: true, [STATUS]: true },
    ]);
  });

  it('binds the condition of a layout ancestor for every child case', () => {
    const root = (expr: string) => el('Card#0', 'Flexbox', cls(expr), variant);
    const child = (binding: StyleBinding) =>
      el('Card#1', 'span', binding, [], { parent: 'Card#0' });
    const [, inner] = planFile(
      'a.tsx',
      extraction([
        root("cx(styles.root, variant === 'card' ? styles.card : styles.listItem)"),
        child(cls('styles.hostname')),
      ]),
      extraction([
        root(
          "cx(stylex.props(styles.root, variant === 'card' ? styles.card : styles.listItem).className)",
        ),
        child(spread('stylex.props(styles.hostname)')),
      ]),
      config,
    ).cases;
    expect(inner.flags).toEqual([]);
    expect(inner.knobs).toEqual(["variant === 'card'"]);
    expect(inner.combos).toHaveLength(2);
  });

  it('keeps the flag when the branches are swapped', () => {
    const entry = single(
      el('Row#0', 'div', cls("cx(styles.a, variant === 'card' ? styles.on : styles.off)"), variant),
      el(
        'Row#0',
        'div',
        cls("stylex.props(styles.a, variant === 'card' ? styles.off : styles.on).className"),
        variant,
      ),
    );
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
    expect(entry.knobs).toBeUndefined();
    expect(entry.combos).toEqual([{}]);
  });

  it('keeps the flag when the conditions differ', () => {
    const entry = single(
      el('Row#0', 'div', cls("cx(styles.a, variant === 'card' && styles.on)"), variant),
      el(
        'Row#0',
        'div',
        cls("stylex.props(styles.a, variant !== 'card' && styles.on).className"),
        variant,
      ),
    );
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('keeps the flag when an unmodeled value is used as a class rather than a condition', () => {
    const extra: VariableUse[] = [{ kind: 'unknown', name: 'extra' }];
    const entry = single(
      el('Row#0', 'div', cls('cx(styles.a, extra)'), extra),
      el('Row#0', 'div', cls('cx(stylex.props(styles.a).className, extra)'), extra),
    );
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('keeps the flag when a condition sits in a shape the canonical form does not read', () => {
    const sizes: VariableUse[] = [{ kind: 'unknown', name: 'size' }];
    const entry = single(
      el('Row#0', 'div', cls("cx(styles.a, SIZES[size] ?? (size === 'lg' && styles.b))"), sizes),
      el(
        'Row#0',
        'div',
        cls("stylex.props(styles.a, SIZES[size] ?? (size === 'lg' && styles.b)).className"),
        sizes,
      ),
    );
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('models knobs once the replaced component is proven to receive the class unchanged', () => {
    const status: VariableUse[] = [{ kind: 'unknown', name: 'status' }];
    const entry = single(
      el('Video#0', 'Text', cls("status === 'error' ? styles.error : undefined"), status),
      el(
        'Video#0',
        'Text',
        cls("stylex.props(status === 'error' ? styles.error : undefined).className"),
        status,
      ),
    );
    expect(entry.flags).toEqual([]);
    expect(entry.evidence).toEqual(['PLACEMENT_PRESERVED', 'CONDITION_KNOBS']);
    expect(entry.knobs).toEqual(["status === 'error'"]);
  });

  it('keeps the flag when the replaced component does not receive the class the same way', () => {
    const status: VariableUse[] = [{ kind: 'unknown', name: 'status' }];
    const entry = single(
      el('Video#0', 'Text', cls("status === 'error' ? styles.error : undefined"), status),
      el(
        'Video#0',
        'Text',
        cls(
          "cx(stylex.props(styles.base).className, stylex.props(status === 'error' ? styles.error : undefined).className)",
        ),
        status,
      ),
    );
    expect(entry.flags).toContain('VARIABLE_UNMODELED');
    expect(entry.knobs).toBeUndefined();
  });

  it('keeps the flag when an ancestor changed its tag', () => {
    const [, inner] = planFile(
      'a.tsx',
      extraction([
        el('Row#0', 'div', cls("variant === 'card' ? styles.card : styles.row"), variant, {
          slots: ['styles.card', 'styles.row'],
        }),
        el('Row#1', 'span', cls('styles.label'), [], { parent: 'Row#0', slots: ['styles.label'] }),
      ]),
      extraction([
        el(
          'Row#0',
          'section',
          cls("stylex.props(variant === 'card' ? styles.card : styles.row).className"),
          variant,
          { slots: ['styles.card', 'styles.row'] },
        ),
        el('Row#1', 'span', cls('stylex.props(styles.label).className'), [], {
          parent: 'Row#0',
          slots: ['styles.label'],
        }),
      ]),
      config,
    ).cases;
    expect(inner.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('keeps the flag for a hand-joined class whose sources overlap', () => {
    const device: VariableUse[] = [{ kind: 'unknown', name: 'device' }];
    const properties = {
      'styles.dot': ['border-width', 'border-style'],
      'styles.online': ['border-style'],
    };
    const [entry] = planFile(
      'a.tsx',
      extraction(
        [
          el(
            'Dot#0',
            'span',
            cls(
              "[styles.dot, device.state === 'on' ? styles.online : undefined].filter(Boolean).join(' ')",
            ),
            device,
          ),
        ],
        properties,
      ),
      extraction(
        [
          el(
            'Dot#0',
            'span',
            cls(
              "[stylex.props(styles.dot).className, device.state === 'on' ? stylex.props(styles.online).className : undefined].filter(Boolean).join(' ')",
            ),
            device,
          ),
        ],
        properties,
      ),
      config,
    ).cases;
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('enumerates more than four knobs pairwise and says so', () => {
    const names = ['a', 'b', 'c', 'd', 'e'];
    const args = names.map((name) => `item.${name} === 1 && styles.${name}`).join(', ');
    const item: VariableUse[] = [{ kind: 'unknown', name: 'item' }];
    const entry = single(
      el('Row#0', 'div', cls(`cx(${args})`), item),
      el('Row#0', 'div', cls(`stylex.props(${args}).className`), item),
    );
    expect(entry.knobs).toHaveLength(5);
    expect(entry.flags).toEqual(['COMBINATIONS_PAIRWISE']);
  });
});

describe('bindKnobs', () => {
  it('replaces each knob expression wherever it appears, whitespace aside', () => {
    expect(
      bindKnobs("cx(styles.a, !(variant  ===  'card') && styles.b)", ["variant === 'card'"]),
    ).toBe('cx(styles.a, !(__v["variant === \'card\'"]) && styles.b)');
  });

  it('does not merge knobs whose string literals differ only in spaces', () => {
    expect(bindKnobs("x === 'a b' && styles.a", ["x === 'ab'"])).toBe("x === 'a b' && styles.a");
  });

  it('leaves property names alone', () => {
    expect(bindKnobs('cx(item.active && styles.a, active && styles.b)', ['active'])).toBe(
      'cx(item.active && styles.a, __v["active"] && styles.b)',
    );
  });

  it('returns undefined for an expression it cannot parse', () => {
    expect(bindKnobs('cx(styles.a,', ['a'])).toBeUndefined();
  });
});
