import { describe, expect, it } from 'vitest';

import { isWidgetSectionVisible } from './config';
import { clampHomeCount, toggleHiddenWidget } from './useHomeCustomization';

describe('toggleHiddenWidget', () => {
  it('hides a visible widget', () => {
    expect(toggleHiddenWidget([], 'news')).toEqual(['news']);
  });

  it('shows a hidden widget', () => {
    expect(toggleHiddenWidget(['news'], 'news')).toEqual([]);
  });

  it('preserves other hidden widgets', () => {
    const result = toggleHiddenWidget(['news'], 'unread');
    expect(result).toContain('news');
    expect(result).toContain('unread');
  });
});

describe('clampHomeCount', () => {
  it('clamps below the minimum', () => {
    expect(clampHomeCount(2)).toBe(3);
  });

  it('clamps above the maximum', () => {
    expect(clampHomeCount(20)).toBe(15);
  });

  it('keeps an in-range value unchanged', () => {
    expect(clampHomeCount(8)).toBe(8);
  });
});

describe('isWidgetSectionVisible', () => {
  it('hides a loading section governed by a hidden widget', () => {
    expect(isWidgetSectionVisible('needsYou-loading', ['needsYou'])).toBe(false);
  });

  it('hides an error section governed by a hidden widget', () => {
    expect(isWidgetSectionVisible('topics-error', ['unread'])).toBe(false);
  });

  it('keeps an unmapped section visible', () => {
    expect(isWidgetSectionVisible('unknown-section', ['unread'])).toBe(true);
  });
});
