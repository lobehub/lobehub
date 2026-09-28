import { describe, expect, it } from 'vitest';

import { filterHiddenWidgetSections, hasVisibleRailWidget } from './hiddenWidgets';
import { resolveInboxScopeToggleSection } from './scopeTogglePlacement';

const assembled = [
  { key: 'needsYou' },
  { key: 'topics-error' },
  { key: 'unread' },
  { key: 'running' },
  { key: 'news' },
];

const keysOf = (sections: { key: string }[]) => sections.map(({ key }) => key);

describe('filterHiddenWidgetSections', () => {
  it('keeps every assembled section when nothing is hidden', () => {
    expect(filterHiddenWidgetSections(assembled, [])).toEqual(assembled);
  });

  it('drops the needs-you section and its loading placeholder, but not its error banner', () => {
    const sections = [...assembled, { key: 'needsYou-error' }, { key: 'needsYou-loading' }];

    expect(keysOf(filterHiddenWidgetSections(sections, ['needsYou']))).toEqual([
      'topics-error',
      'unread',
      'running',
      'news',
      'needsYou-error',
    ]);
  });

  it('drops the briefs error banner once news is hidden alongside needs-you', () => {
    const sections = [...assembled, { key: 'needsYou-error' }];

    expect(keysOf(filterHiddenWidgetSections(sections, ['needsYou', 'news']))).toEqual([
      'topics-error',
      'unread',
      'running',
    ]);
  });

  it('keeps the topic error banner when only unread is hidden, since running shares the feed', () => {
    expect(keysOf(filterHiddenWidgetSections(assembled, ['unread']))).toEqual([
      'needsYou',
      'topics-error',
      'running',
      'news',
    ]);
  });

  it('drops the topic error banner once running is hidden alongside unread', () => {
    expect(keysOf(filterHiddenWidgetSections(assembled, ['unread', 'running']))).toEqual([
      'needsYou',
      'news',
    ]);
  });

  it('empties the inbox when every widget is hidden', () => {
    expect(
      filterHiddenWidgetSections(assembled, ['needsYou', 'unread', 'running', 'news']),
    ).toEqual([]);
  });
});

describe('hasVisibleRailWidget', () => {
  const railColumn = { hideNeedsYou: true, hideUnread: true };

  it('keeps the rail while nothing is hidden', () => {
    expect(hasVisibleRailWidget({ ...railColumn, hiddenWidgets: [] })).toBe(true);
  });

  it('keeps the rail while one of the widgets it hosts is still on', () => {
    expect(hasVisibleRailWidget({ ...railColumn, hiddenWidgets: ['running', 'news'] })).toBe(true);
  });

  // Covers both kinds of section the rail never shows: the ones this column
  // suppresses by prop, and the main column's own recents/tasks — counting
  // either would keep an empty rail on screen forever.
  it('drops the rail once every widget it hosts is off, ignoring the ones it never shows', () => {
    expect(
      hasVisibleRailWidget({
        ...railColumn,
        hiddenWidgets: ['goals', 'running', 'news', 'suggestions'],
      }),
    ).toBe(false);
  });

  it('drops the rail when every widget is off', () => {
    expect(
      hasVisibleRailWidget({
        ...railColumn,
        hiddenWidgets: ['goals', 'needsYou', 'unread', 'running', 'news', 'suggestions'],
      }),
    ).toBe(false);
  });

  it('keeps a column that hosts needs-you and unread on the same hidden set', () => {
    expect(hasVisibleRailWidget({ hiddenWidgets: ['running', 'news', 'suggestions'] })).toBe(true);
  });

  // The usage widget is a business slot: it must hold the rail open only where
  // the slot actually renders something, or an OSS page hiding the other rail
  // widgets would keep an empty rail on screen.
  it('counts the usage widget only while its slot is active', () => {
    const everythingElseHidden = {
      ...railColumn,
      hiddenWidgets: ['goals', 'running', 'news', 'suggestions'],
    };

    expect(hasVisibleRailWidget(everythingElseHidden)).toBe(false);
    expect(hasVisibleRailWidget({ ...everythingElseHidden, usageActive: true })).toBe(true);
  });

  it('drops the rail once an active usage widget is switched off with the rest', () => {
    expect(
      hasVisibleRailWidget({
        ...railColumn,
        hiddenWidgets: ['goals', 'running', 'news', 'suggestions', 'usage'],
        usageActive: true,
      }),
    ).toBe(false);
  });
});

describe('resolveInboxScopeToggleSection', () => {
  const populated = { needsYouCount: 2, unreadCount: 3 };

  it('keeps the scope toggle on needs-you while that widget is visible', () => {
    expect(resolveInboxScopeToggleSection({ ...populated, hiddenWidgets: [] })).toBe('needsYou');
  });

  it('moves the scope toggle to unread when needs-you is hidden', () => {
    expect(resolveInboxScopeToggleSection({ ...populated, hiddenWidgets: ['needsYou'] })).toBe(
      'unread',
    );
  });

  it('hides the scope toggle when both titled topic widgets are hidden', () => {
    expect(
      resolveInboxScopeToggleSection({ ...populated, hiddenWidgets: ['needsYou', 'unread'] }),
    ).toBeNull();
  });

  it('gives up the scope toggle only once every host widget is hidden', () => {
    expect(
      resolveInboxScopeToggleSection({
        ...populated,
        hiddenWidgets: ['needsYou', 'unread', 'running'],
      }),
    ).toBeNull();
  });

  it('suppresses titled sections through the task-mode props as well as the hidden set', () => {
    expect(
      resolveInboxScopeToggleSection({
        ...populated,
        hiddenWidgets: [],
        hideNeedsYou: true,
        hideUnread: true,
      }),
    ).toBeNull();
  });

  it('still leads with unread in the main column when needs-you is hidden', () => {
    expect(
      resolveInboxScopeToggleSection({
        ...populated,
        hiddenWidgets: ['needsYou'],
        preferUnread: true,
      }),
    ).toBe('unread');
  });

  it('skips a hidden unread widget even when the main column prefers it', () => {
    expect(
      resolveInboxScopeToggleSection({
        ...populated,
        hiddenWidgets: ['unread'],
        preferUnread: true,
      }),
    ).toBe('needsYou');
  });

  it('skips sections with nothing in them and lands on the one that has content', () => {
    expect(
      resolveInboxScopeToggleSection({
        hiddenWidgets: [],
        needsYouCount: 0,
        unreadCount: 4,
      }),
    ).toBe('unread');
  });
});
