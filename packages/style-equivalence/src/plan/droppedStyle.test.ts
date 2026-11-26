import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: ['Flexbox'] };

const base = (lane = '<div className={styles.lane} style={laneStyle} />') => `
import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({ lane: css\`display: flex;\` }));

export const Layout = ({ laneStyle, size }) => ${lane};
`;

const head = (lane = '<div {...stylex.props(styles.lane)} />') => `
import * as stylex from '@stylexjs/stylex';
import { sx } from '@/styles/sx';

const styles = stylex.create({ lane: { display: 'flex' } });

export const Layout = ({ laneStyle, size }) => ${lane};
`;

const plan = (before: string, after: string) =>
  planFile('a.tsx', extractFile(before, 'a.tsx', options), extractFile(after, 'a.tsx', options), {
    layoutComponents: ['Flexbox'],
  }).cases;

describe('a runtime style present on one side only', () => {
  it('records the style expression even beside a spread', () => {
    const [lane] = extractFile(
      head('<div {...stylex.props(styles.lane)} style={laneStyle} />'),
      'a.tsx',
      options,
    ).elements;
    expect(lane.styleExpr).toBe('laneStyle');
    expect(lane.runtimeStyle).toBeUndefined();
  });

  it('flags a style the head drops entirely', () => {
    expect(plan(base(), head())[0].flags).toEqual(['RUNTIME_STYLE_DROPPED']);
  });

  it('flags a style only the head passes', () => {
    const cases = plan(
      base('<div className={styles.lane} />'),
      head('<div {...stylex.props(styles.lane)} style={laneStyle} />'),
    );
    expect(cases[0].flags).toEqual(['RUNTIME_STYLE_DROPPED']);
  });

  it('flags a dropped style object that reads runtime values', () => {
    const cases = plan(base('<div className={styles.lane} style={{ width: size }} />'), head());
    expect(cases[0].flags).toEqual(['RUNTIME_STYLE_DROPPED']);
  });

  it('does not flag a style both sides keep', () => {
    const cases = plan(base(), head('<div {...stylex.props(styles.lane)} style={laneStyle} />'));
    expect(cases[0].flags).toEqual([]);
  });

  it('does not flag a style the head moves into its style call', () => {
    const cases = plan(base(), head('<div {...sx(styles.lane, undefined, laneStyle)} />'));
    expect(cases[0].flags).toEqual([]);
    expect(cases[0].evidence).toEqual(['RUNTIME_STYLE_PROBED']);
  });

  it('leaves a static style object to the rendered comparison', () => {
    const before = base('<div className={styles.lane} style={{ fontSize: 18, margin: 0 }} />');
    const [lane] = extractFile(before, 'a.tsx', options).elements;
    expect(lane.literalProps.style).toEqual({ fontSize: 18, margin: 0 });
    expect(lane.styleExpr).toBeUndefined();
    expect(plan(before, head())[0].flags).toEqual([]);
  });
});
