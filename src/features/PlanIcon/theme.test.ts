import { Plans } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getPlanTheme, getUnknownPlanTitle, themes } from './theme';

describe('getPlanTheme', () => {
  it('returns the palette of a known plan', () => {
    expect(getPlanTheme(Plans.Pro)).toBe(themes[Plans.Pro].theme);
  });

  it('falls back to the Free palette for a plan newer than this build', () => {
    // An installed desktop build receives `basic` from the server before it knows the plan.
    expect(() => getPlanTheme('basic')).not.toThrow();
    expect(getPlanTheme('basic')).toBe(themes[Plans.Free].theme);
  });

  it('falls back to the Free palette for a missing plan or an inherited object key', () => {
    expect(getPlanTheme(undefined)).toBe(themes[Plans.Free].theme);
    expect(getPlanTheme(null)).toBe(themes[Plans.Free].theme);
    expect(getPlanTheme('toString')).toBe(themes[Plans.Free].theme);
  });
});

describe('getUnknownPlanTitle', () => {
  it('capitalizes the plan id', () => {
    expect(getUnknownPlanTitle('basic')).toBe('Basic');
  });

  it('keeps an empty id empty', () => {
    expect(getUnknownPlanTitle('')).toBe('');
  });
});
