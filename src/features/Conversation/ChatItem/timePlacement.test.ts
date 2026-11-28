import { describe, expect, it } from 'vitest';

import { shouldInlineTimeInActions } from './timePlacement';

const userTimeOnly = {
  compact: true,
  hasHeaderAddon: false,
  isUser: true,
  showAvatar: false,
  showTitle: false,
};

describe('shouldInlineTimeInActions', () => {
  it('moves a time-only user header into the actions row in compact', () => {
    expect(shouldInlineTimeInActions(userTimeOnly)).toBe(true);
  });

  it('keeps the header in loose', () => {
    expect(shouldInlineTimeInActions({ ...userTimeOnly, compact: false })).toBe(false);
  });

  it('keeps the header for assistant messages', () => {
    expect(shouldInlineTimeInActions({ ...userTimeOnly, isUser: false })).toBe(false);
  });

  it('keeps the header when the user sender is shown', () => {
    expect(shouldInlineTimeInActions({ ...userTimeOnly, showAvatar: true })).toBe(false);
    expect(shouldInlineTimeInActions({ ...userTimeOnly, showTitle: true })).toBe(false);
  });

  it('keeps the header when it carries an addon such as an event source', () => {
    expect(shouldInlineTimeInActions({ ...userTimeOnly, hasHeaderAddon: true })).toBe(false);
  });
});
