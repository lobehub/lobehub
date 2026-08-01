import { describe, expect, it } from 'vitest';

import { filterTopicsForInboxScope, resolveScopeToggleSection } from './scopeTogglePlacement';

describe('resolveScopeToggleSection', () => {
  it('keeps the team scope control on a rail Needs-you card', () => {
    expect(
      resolveScopeToggleSection({ hasNeedsYou: true, hasRunning: false, hasUnread: false }),
    ).toBe('needsYou');
  });

  it('falls through to the first topic section when no brief needs attention', () => {
    expect(
      resolveScopeToggleSection({ hasNeedsYou: false, hasRunning: true, hasUnread: false }),
    ).toBe('running');
  });

  it('places the scope control on unread when the main feed leads with unread', () => {
    expect(
      resolveScopeToggleSection({
        hasNeedsYou: true,
        hasRunning: false,
        hasUnread: true,
        preferUnread: true,
      }),
    ).toBe('unread');
  });

  it('keeps the default inbox scope restricted to the current user', () => {
    const topics = [
      { id: 'mine', userId: 'me' },
      { id: 'theirs', userId: 'teammate' },
    ];

    expect(filterTopicsForInboxScope(topics, 'me', false)).toEqual([topics[0]]);
    expect(filterTopicsForInboxScope(topics, 'me', true)).toEqual(topics);
  });
});
