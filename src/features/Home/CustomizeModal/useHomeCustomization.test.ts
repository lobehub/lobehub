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

  it('keeps the topic error banner while running still needs it', () => {
    expect(isWidgetSectionVisible('topics-error', ['unread'])).toBe(true);
  });

  it('hides the topic error banner only once unread and running are both hidden', () => {
    expect(isWidgetSectionVisible('topics-error', ['unread', 'running'])).toBe(false);
  });

  it('keeps the briefs error banner while news still needs it', () => {
    expect(isWidgetSectionVisible('needsYou-error', ['needsYou'])).toBe(true);
  });

  it('hides the briefs error banner only once needs-you and news are both hidden', () => {
    expect(isWidgetSectionVisible('needsYou-error', ['needsYou', 'news'])).toBe(false);
  });

  it('keeps an unmapped section visible', () => {
    expect(isWidgetSectionVisible('unknown-section', ['unread'])).toBe(true);
  });
});
