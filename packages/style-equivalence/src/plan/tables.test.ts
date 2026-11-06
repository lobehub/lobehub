import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { combosFor } from './combos';
import { planFile } from './planFile';
import { ABSENT_KEY } from './tables';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: ['Flexbox'] };

const base = (
  table = `{
  added: styles.kindAdded,
  deleted: styles.kindDeleted,
}`,
) => `import { createStaticStyles, cx } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  kindAdded: css\`background: green;\`,
  kindDeleted: css\`background: red;\`,
  kindDot: css\`width: 8px;\`,
}));

const KIND_CLASS: Record<Kind, string> = ${table};

export const KindDot = ({ className, kind }) => (
  <span className={cx(styles.kindDot, KIND_CLASS[kind], className)} />
);
`;

const head = (lookup = 'KIND_STYLE[kind]') => `import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  kindAdded: { backgroundColor: 'green' },
  kindDeleted: { backgroundColor: 'red' },
  kindDot: { width: '8px' },
});

const KIND_STYLE = {
  added: styles.kindAdded,
  deleted: styles.kindDeleted,
} as const satisfies Record<Kind, unknown>;

export const KindDot = ({ className, kind }) => (
  <span className={cx(stylex.props(styles.kindDot, ${lookup}).className, className)} />
);
`;

const plan = (before: string, after: string) =>
  planFile('a.tsx', extractFile(before, 'a.tsx', options), extractFile(after, 'a.tsx', options), {
    layoutComponents: ['Flexbox'],
  }).cases[0];

describe('fixed table lookups', () => {
  it('records the key set of every top-level const object literal that is only read', () => {
    expect(extractFile(base(), 'a.tsx', options).tables).toEqual({
      KIND_CLASS: ['added', 'deleted'],
    });
    expect(extractFile(head(), 'a.tsx', options).tables).toEqual({
      KIND_STYLE: ['added', 'deleted'],
    });
  });

  it('skips a table that is written to, spread from or keyed by a computed name', () => {
    const written = `${base()}\nKIND_CLASS.added = 'x';`;
    expect(extractFile(written, 'a.tsx', options).tables).toEqual({});
    const spread = base(`{ ...OTHER, added: styles.kindAdded }`);
    expect(extractFile(spread, 'a.tsx', options).tables).toEqual({});
    const computed = base(`{ [KEY]: styles.kindAdded }`);
    expect(extractFile(computed, 'a.tsx', options).tables).toEqual({});
  });

  it('models a lookup key over the shared key set and every key renders', () => {
    const entry = plan(base(), head());
    expect(entry.flags).toEqual([]);
    expect(entry.evidence).toEqual(['TABLE_KEYS']);
    expect(entry.variables).toEqual([
      {
        kinds: { base: 'unknown', head: 'unknown' },
        name: 'kind',
        values: ['added', 'deleted', ABSENT_KEY],
      },
    ]);
    expect(entry.combos).toEqual([{ kind: 'added' }, { kind: 'deleted' }, { kind: ABSENT_KEY }]);
  });

  it('keeps the flag when the two tables have different keys', () => {
    const entry = plan(
      base(`{ added: styles.kindAdded, deleted: styles.kindDeleted, renamed: styles.kindAdded }`),
      head(),
    );
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
    expect(entry.evidence).toBeUndefined();
  });

  it('keeps the flag when the key is also used outside the lookup', () => {
    const entry = plan(base(), head(`kind === 'added' && KIND_STYLE[kind]`));
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('keeps the flag when the looked-up value is read further', () => {
    const entry = plan(base(), head('KIND_STYLE[kind].x'));
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('keeps the flag when the table is not a local const literal', () => {
    const entry = plan(base(), head('IMPORTED[kind]'));
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
  });
});

describe('combosFor with value domains', () => {
  it('crosses every boolean combination with every domain value', () => {
    expect(combosFor(['on', 'tone'], { tone: ['a', 'b'] }).combos).toEqual([
      { on: false, tone: 'a' },
      { on: false, tone: 'b' },
      { on: true, tone: 'a' },
      { on: true, tone: 'b' },
    ]);
  });
});
