import { describe, expect, it } from 'vitest';

import { filterHiddenWidgetSections } from './hiddenWidgets';
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

  it('drops the needs-you section together with its error and loading placeholders', () => {
    const sections = [...assembled, { key: 'needsYou-error' }, { key: 'needsYou-loading' }];

    expect(keysOf(filterHiddenWidgetSections(sections, ['needsYou']))).toEqual([
      'topics-error',
      'unread',
      'running',
      'news',
    ]);
  });

  it('takes the topic error banner down with the unread section it reports on', () => {
    expect(keysOf(filterHiddenWidgetSections(assembled, ['unread']))).toEqual([
      'needsYou',
      'running',
      'news',
    ]);
  });

  it('empties the inbox when every widget is hidden', () => {
    expect(
      filterHiddenWidgetSections(assembled, ['needsYou', 'unread', 'running', 'news']),
    ).toEqual([]);
  });
});

describe('resolveInboxScopeToggleSection', () => {
  const populated = { needsYouCount: 2, runningCount: 1, unreadCount: 3 };

  it('keeps the scope toggle on needs-you while that widget is visible', () => {
    expect(resolveInboxScopeToggleSection({ ...populated, hiddenWidgets: [] })).toBe('needsYou');
  });

  it('moves the scope toggle to unread when needs-you is hidden', () => {
    expect(resolveInboxScopeToggleSection({ ...populated, hiddenWidgets: ['needsYou'] })).toBe(
      'unread',
    );
  });

  it('falls through to running when both leading widgets are hidden', () => {
    expect(
      resolveInboxScopeToggleSection({ ...populated, hiddenWidgets: ['needsYou', 'unread'] }),
    ).toBe('running');
  });

  it('gives up the scope toggle only once every host widget is hidden', () => {
    expect(
      resolveInboxScopeToggleSection({
        ...populated,
        hiddenWidgets: ['needsYou', 'unread', 'running'],
      }),
    ).toBeNull();
  });

  it('suppresses a section through the task-mode props as well as the hidden set', () => {
    expect(
      resolveInboxScopeToggleSection({
        ...populated,
        hiddenWidgets: [],
        hideNeedsYou: true,
        hideUnread: true,
      }),
    ).toBe('running');
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

  it('leaves an empty section without the toggle regardless of the hidden set', () => {
    expect(
      resolveInboxScopeToggleSection({
        hiddenWidgets: [],
        needsYouCount: 0,
        runningCount: 0,
        unreadCount: 4,
      }),
    ).toBe('unread');
  });
});
