import { describe, expect, it } from 'vitest';

import { resolveGroupSidebarMode } from './resolveGroupSidebarMode';

describe('resolveGroupSidebarMode', () => {
  /** @example A byAgent preference leaked from a project sidebar must not render as time-bucket translation keys in group chats. */
  it('falls back to byTime for byAgent, which the group sidebar cannot render', () => {
    // ROOT CAUSE: the project sidebar persists byAgent into the global
    // preference, and the group-chat sidebar renders every non-flat mode
    // through its time renderer, whose headers format unknown group ids as
    // `groupTitle.byTime.*` translation keys.
    expect(resolveGroupSidebarMode('byAgent')).toBe('byTime');
  });

  it('keeps every mode the group sidebar menu offers', () => {
    expect(resolveGroupSidebarMode('byTime')).toBe('byTime');
    expect(resolveGroupSidebarMode('byProject')).toBe('byProject');
    expect(resolveGroupSidebarMode('byStatus')).toBe('byStatus');
    expect(resolveGroupSidebarMode('flat')).toBe('flat');
  });
});
