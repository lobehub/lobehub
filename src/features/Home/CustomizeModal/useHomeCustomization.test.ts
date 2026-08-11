import { describe, expect, it } from 'vitest';

import {
  HOME_PRESETS,
  HOME_WIDGET_GROUPS,
  HOME_WIDGET_KEYS,
  isHomeMinimalLayout,
  isHomeWidgetHidden,
  isWidgetSectionVisible,
  resolveHomePreset,
} from './config';
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

describe('resolveHomePreset', () => {
  const stateOf = (key: keyof typeof HOME_PRESETS) => ({
    hiddenWidgets: [...HOME_PRESETS[key].hiddenWidgets],
    showPortrait: HOME_PRESETS[key].showPortrait,
  });

  it('names each preset from the switches it spells out', () => {
    expect(resolveHomePreset(stateOf('minimal'))).toBe('minimal');
    expect(resolveHomePreset(stateOf('balanced'))).toBe('balanced');
    expect(resolveHomePreset(stateOf('full'))).toBe('full');
  });

  it('ignores the order the hidden widgets were stored in', () => {
    expect(
      resolveHomePreset({
        hiddenWidgets: ['suggestions', 'news', 'unread', 'running'],
        showPortrait: false,
      }),
    ).toBe('balanced');
  });

  it('ignores keys it does not know, so a stale entry cannot mask a preset', () => {
    expect(resolveHomePreset({ hiddenWidgets: ['retiredWidget'], showPortrait: true })).toBe(
      'full',
    );
  });

  it('names no preset once a single switch departs from one', () => {
    expect(resolveHomePreset({ hiddenWidgets: ['news'], showPortrait: true })).toBeUndefined();
  });

  it('tells the presets apart by the portrait alone', () => {
    expect(resolveHomePreset({ hiddenWidgets: [], showPortrait: false })).toBeUndefined();
  });
});

describe('isHomeMinimalLayout', () => {
  it('centers the page once every section and the portrait are off', () => {
    expect(isHomeMinimalLayout({ hiddenWidgets: [...HOME_WIDGET_KEYS], showPortrait: false })).toBe(
      true,
    );
  });

  it('keeps the dashboard while the portrait still has a lane to sit in', () => {
    expect(isHomeMinimalLayout({ hiddenWidgets: [...HOME_WIDGET_KEYS], showPortrait: true })).toBe(
      false,
    );
  });

  it('keeps the dashboard while one section still has something to stack', () => {
    expect(
      isHomeMinimalLayout({
        hiddenWidgets: HOME_WIDGET_KEYS.filter((key) => key !== 'tasks'),
        showPortrait: false,
      }),
    ).toBe(false);
  });
});

describe('HOME_WIDGET_GROUPS', () => {
  const grouped = HOME_WIDGET_GROUPS.flatMap((group) => group.widgets);

  it('gives every widget exactly one group, so none can fall out of the panel', () => {
    expect([...grouped].sort()).toEqual([...HOME_WIDGET_KEYS].sort());
  });

  // The groups name where a section sits on Home, so membership is a fact about
  // the page rather than a taste call. `RAIL_INBOX_PROPS` keeps needs-you and
  // unread out of the rail, and `ownsRailSections` gives running / news /
  // suggestions to it; goals renders in the rail card. Move a section between
  // columns and this test is the thing that says the panel now lies.
  it.each([
    ['agent', ['recents', 'unread', 'needsYou']],
    ['task', ['tasks', 'scheduledTasks']],
    ['rail', ['goals', 'running', 'news', 'suggestions']],
  ])('groups %s by where those sections render on Home', (key, widgets) => {
    expect(HOME_WIDGET_GROUPS.find((group) => group.key === key)?.widgets).toEqual(widgets);
  });
});

describe('isHomeWidgetHidden', () => {
  // Everything a minimal-preset page stored before the scheduled block existed.
  const LEGACY_ALL_HIDDEN = HOME_WIDGET_KEYS.filter((key) => key !== 'scheduledTasks');

  it('hides the scheduled block along with the task list it belongs to', () => {
    expect(isHomeWidgetHidden('scheduledTasks', ['tasks'])).toBe(true);
  });

  it('lets the scheduled block be switched off on its own', () => {
    expect(isHomeWidgetHidden('scheduledTasks', ['scheduledTasks'])).toBe(true);
    expect(isHomeWidgetHidden('tasks', ['scheduledTasks'])).toBe(false);
  });

  it('leaves both on when neither is listed', () => {
    expect(isHomeWidgetHidden('scheduledTasks', ['news'])).toBe(false);
  });

  it('does not grow a section back onto a page saved before the key existed', () => {
    expect(resolveHomePreset({ hiddenWidgets: LEGACY_ALL_HIDDEN, showPortrait: false })).toBe(
      'minimal',
    );
    expect(isHomeMinimalLayout({ hiddenWidgets: LEGACY_ALL_HIDDEN, showPortrait: false })).toBe(
      true,
    );
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
