import { describe, expect, it } from 'vitest';

import { resolveScopeToggleSection } from './scopeTogglePlacement';

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
});
