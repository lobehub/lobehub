import { describe, expect, it } from 'vitest';

import { ownsRailSections } from './railSectionPlacement';

describe('ownsRailSections', () => {
  it('leaves goals and news to the rail while it is open', () => {
    expect(ownsRailSections({ variant: 'main' })).toBe(false);
    expect(ownsRailSections({ inlineRail: false, variant: 'main' })).toBe(false);
  });

  it('hands them to the main column once the rail folds away', () => {
    expect(ownsRailSections({ inlineRail: true, variant: 'main' })).toBe(true);
  });

  it('keeps them in the rail itself, folded or not', () => {
    expect(ownsRailSections({ variant: 'rail' })).toBe(true);
    expect(ownsRailSections({ inlineRail: true, variant: 'rail' })).toBe(true);
  });

  it('keeps the single-column default carrying everything', () => {
    expect(ownsRailSections({ variant: 'default' })).toBe(true);
  });
});
