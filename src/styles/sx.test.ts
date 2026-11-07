import * as stylex from '@stylexjs/stylex';
import { describe, expect, it } from 'vitest';

import { sx } from './sx';

const styles = stylex.create({
  active: { color: 'red' },
  root: { display: 'flex' },
  width: (width: number) => ({ width }),
});

describe('sx', () => {
  it('keeps StyleX classes and appends the caller className', () => {
    const { className = '' } = sx(styles.root, styles.active, 'caller');

    expect(className).toContain('styles.root');
    expect(className).toContain('styles.active');
    expect(className.endsWith(' caller')).toBe(true);
  });

  it('drops falsy styles and class names', () => {
    const active = false;
    const props = sx(styles.root, active && styles.active, undefined, '');

    expect(props.className).toContain('styles.root');
    expect(props.className).not.toContain('styles.active');
    expect(props.className?.endsWith(' ')).toBe(false);
  });

  it('takes an inline style without a className placeholder', () => {
    const props = sx(styles.width(120), { opacity: 0.5 });

    expect(props.style).toMatchObject({ opacity: 0.5 });
    expect(Object.values(props.style ?? {})).toContain('120px');
  });

  it('lets later inline styles win over earlier ones', () => {
    const props = sx(styles.root, { opacity: 0.5 }, 'caller', { opacity: 1 });

    expect(props.style).toEqual({ opacity: 1 });
    expect(props.className?.endsWith(' caller')).toBe(true);
  });

  it('still accepts nested StyleX arrays such as an xstyle prop', () => {
    const xstyle = [styles.root, [styles.active]];
    const { className = '' } = sx(xstyle);

    expect(className).toContain('styles.root');
    expect(className).toContain('styles.active');
  });

  it('returns undefined for empty className and style', () => {
    expect(sx(null)).toEqual({ className: undefined, style: undefined });
    expect(sx()).toEqual({ className: undefined, style: undefined });
  });
});
