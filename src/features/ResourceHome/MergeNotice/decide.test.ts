import { describe, expect, it } from 'vitest';

import { decideMergeNotice } from './decide';

describe('decideMergeNotice', () => {
  it('waits until the user state has loaded', () => {
    expect(decideMergeNotice({ hasConversation: true, ready: false, seen: false })).toBe('wait');
  });

  it('shows the notice once to a returning user who chatted before', () => {
    expect(decideMergeNotice({ hasConversation: true, ready: true, seen: false })).toBe('show');
    expect(decideMergeNotice({ hasConversation: true, ready: true, seen: true })).toBe('none');
  });

  it('shows it to a workspace-only user whose pages or files are here', () => {
    expect(
      decideMergeNotice({ hasContent: true, hasConversation: false, ready: true, seen: false }),
    ).toBe('show');
  });

  it('waits for the content check before treating someone as new', () => {
    expect(decideMergeNotice({ hasConversation: false, ready: true, seen: false })).toBe('wait');
  });

  it('marks it seen for a newcomer with nothing here, without showing it', () => {
    expect(
      decideMergeNotice({ hasContent: false, hasConversation: false, ready: true, seen: false }),
    ).toBe('mark-seen');
  });
});
