import { describe, expect, it } from 'vitest';

import { encodeMobileSelection, isStackedLayout, parseMobileSelection } from './mobileSelection';

describe('mobile skill selection param', () => {
  it('round-trips a selection, including identifiers that contain a colon', () => {
    const selection = { identifier: 'lobehub:web-search', type: 'builtin' as const };

    expect(parseMobileSelection(encodeMobileSelection(selection))).toEqual(selection);
  });

  it('shows the list for a missing or malformed value', () => {
    expect(parseMobileSelection(null)).toBeUndefined();
    expect(parseMobileSelection('builtin')).toBeUndefined();
    expect(parseMobileSelection('unknown:web-search')).toBeUndefined();
    expect(parseMobileSelection('builtin:')).toBeUndefined();
  });
});

describe('isStackedLayout', () => {
  it('opens connectors as list → detail on desktop too, keeping the skill split', () => {
    expect(isStackedLayout(false, 'connector')).toBe(true);
    expect(isStackedLayout(false, 'skill')).toBe(false);
    expect(isStackedLayout(true, 'skill')).toBe(true);
  });
});
