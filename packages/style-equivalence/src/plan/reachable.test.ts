import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: [] };

const base = (body: string) => `import { createStaticStyles, cx } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  quote: css\`color: red;\`,
  clickable: css\`cursor: pointer;\`,
  orphaned: css\`opacity: 0.5;\`,
}));

${body}
`;

const head = (body: string) => `import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  quote: { color: 'red' },
  clickable: { cursor: 'pointer' },
  orphaned: { opacity: 0.5 },
});

${body}
`;

const plan = (before: string, after: string) =>
  planFile('a.tsx', extractFile(before, 'a.tsx', options), extractFile(after, 'a.tsx', options), {
    layoutComponents: [],
  }).cases;

describe('combinations the source cannot reach', () => {
  it('drops the combination a derived condition rules out on both sides', () => {
    const [entry] = plan(
      base(`export const Quote = ({ onLocate, orphaned }) => {
  const clickable = Boolean(onLocate) && !orphaned;
  return <div className={cx(styles.quote, clickable && styles.clickable, orphaned && styles.orphaned)} />;
};`),
      head(`export const Quote = ({ onLocate, orphaned }) => {
  const clickable = Boolean(onLocate) && !orphaned;
  return <div {...stylex.props(styles.quote, clickable && styles.clickable, orphaned && styles.orphaned)} />;
};`),
    );
    expect(entry.combos).toEqual([
      { clickable: false, orphaned: false },
      { clickable: true, orphaned: false },
      { clickable: false, orphaned: true },
    ]);
    expect(entry.evidence).toContain('COMBOS_UNREACHABLE_DROPPED');
  });

  it('drops the combinations an element is never rendered in', () => {
    const [entry] = plan(
      base(`export const Quote = ({ collapsed, orphaned }) =>
  !collapsed && <div className={cx(styles.quote, collapsed && styles.clickable, orphaned && styles.orphaned)} />;`),
      head(`export const Quote = ({ collapsed, orphaned }) =>
  !collapsed && <div {...stylex.props(styles.quote, collapsed && styles.clickable, orphaned && styles.orphaned)} />;`),
    );
    expect(entry.combos).toEqual([
      { collapsed: false, orphaned: false },
      { collapsed: false, orphaned: true },
    ]);
  });

  it('keeps every combination one side can still reach', () => {
    const [entry] = plan(
      base(`export const Quote = ({ onLocate, orphaned }) => {
  const clickable = Boolean(onLocate) && !orphaned;
  return <div className={cx(styles.quote, clickable && styles.clickable, orphaned && styles.orphaned)} />;
};`),
      head(`export const Quote = ({ clickable, orphaned }) => (
  <div {...stylex.props(styles.quote, clickable && styles.clickable, orphaned && styles.orphaned)} />
);`),
    );
    expect(entry.combos).toHaveLength(4);
  });

  it('treats a value the component does not model as possibly undefined', () => {
    const [entry] = plan(
      base(`export const Quote = ({ defaultCollapsed, orphaned }) => {
  const clickable = defaultCollapsed !== undefined;
  return <div className={cx(styles.quote, clickable && styles.clickable, orphaned && styles.orphaned)} />;
};`),
      head(`export const Quote = ({ defaultCollapsed, orphaned }) => {
  const clickable = defaultCollapsed !== undefined;
  return <div {...stylex.props(styles.quote, clickable && styles.clickable, orphaned && styles.orphaned)} />;
};`),
    );
    expect(entry.combos).toHaveLength(4);
  });
});
