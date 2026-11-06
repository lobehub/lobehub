import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: ['Flexbox'] };

const base = (
  lane = '<div className={styles.lane} style={laneStyle}>',
) => `import { createStaticStyles } from '@lobehub/ui';
import { sx } from '@/styles/sx';

const styles = createStaticStyles(({ css }) => ({
  header: css\`height: 44px;\`,
  lane: css\`display: flex;\`,
}));

export const Layout = ({ laneStyle }) => (
  ${lane}
    <header className={styles.header} />
  </div>
);
`;

const head = (
  lane = '<div {...sx(styles.lane, undefined, laneStyle)}>',
  header = '<header {...stylex.props(styles.header)} />',
) => `import * as stylex from '@stylexjs/stylex';
import { sx } from '@/styles/sx';

const styles = stylex.create({
  header: { height: '44px' },
  lane: { display: 'flex' },
});

export const Layout = ({ laneStyle }) => (
  ${lane}
    ${header}
  </div>
);
`;

const plan = (before: string, after: string) =>
  planFile('a.tsx', extractFile(before, 'a.tsx', options), extractFile(after, 'a.tsx', options), {
    layoutComponents: ['Flexbox'],
  }).cases;

describe('runtime style passed through on both sides', () => {
  it('records an identifier passed straight to style on a styled element', () => {
    const [lane] = extractFile(base(), 'a.tsx', options).elements;
    expect(lane.runtimeStyle).toBe('laneStyle');
  });

  it('probes the value on the element and every descendant case', () => {
    const cases = plan(base(), head());
    expect(cases).toHaveLength(2);
    for (const entry of cases) {
      expect(entry.flags).toEqual([]);
      expect(entry.evidence).toEqual(['RUNTIME_STYLE_PROBED']);
      expect(entry.variables).toEqual([
        { kinds: { head: 'unknown' }, name: 'laneStyle', probe: true },
      ]);
      expect(entry.combos).toEqual([{ laneStyle: false }, { laneStyle: true }]);
    }
  });

  it('keeps the flag when neither side passes the value straight to style', () => {
    const cases = plan(base('<div {...sx(styles.lane, undefined, laneStyle)}>'), head());
    expect(cases[0].flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('flags a style that only one side places next to a spread', () => {
    const cases = plan(base('<div {...props} className={styles.lane} style={laneStyle}>'), head());
    expect(cases[0].flags).toEqual(['INLINE_STYLE_SPREAD_ORDER']);
  });

  it('keeps the flag when the other side reads into the value', () => {
    const cases = plan(base(), head('<div {...sx(styles.lane, undefined, laneStyle.inner)}>'));
    expect(cases[0].flags).toEqual(['VARIABLE_UNMODELED']);
    expect(cases[0].evidence).toBeUndefined();
  });

  it('keeps the flag when the other side hands the value to another element', () => {
    const cases = plan(
      base(),
      head(
        '<div {...stylex.props(styles.lane)}>',
        '<header {...sx(styles.header, undefined, laneStyle)} />',
      ),
    );
    expect(cases[1].flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('keeps the flag when the other side passes the value twice', () => {
    const cases = plan(base(), head('<div {...sx(styles.lane, laneStyle, laneStyle)}>'));
    expect(cases[0].flags).toEqual(['VARIABLE_UNMODELED']);
  });
});
