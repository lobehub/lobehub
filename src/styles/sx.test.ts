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
    const { className = '' } = sx([styles.root, styles.active], 'caller');

    expect(className).toContain('styles.root');
    expect(className).toContain('styles.active');
    expect(className.endsWith(' caller')).toBe(true);
  });

  it('drops falsy styles', () => {
    const active = false;
    const props = sx([styles.root, active && styles.active]);

    expect(props.className).toContain('styles.root');
    expect(props.className).not.toContain('styles.active');
  });

  it('merges dynamic StyleX styles with the caller style', () => {
    const props = sx(styles.width(120), undefined, { opacity: 0.5 });

    expect(props.style).toMatchObject({ opacity: 0.5 });
    expect(Object.values(props.style ?? {})).toContain('120px');
  });

  it('returns undefined for empty className and style', () => {
    expect(sx(null)).toEqual({ className: undefined, style: undefined });
  });
});
