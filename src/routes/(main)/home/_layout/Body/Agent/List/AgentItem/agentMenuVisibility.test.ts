// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { shouldShowAgentDeleteMenuItem } from './agentMenuVisibility';

describe('shouldShowAgentDeleteMenuItem', () => {
  it('shows Delete only when the agent can be edited and managed', () => {
    expect(shouldShowAgentDeleteMenuItem({ canEdit: true, canManage: true })).toBe(true);
    expect(shouldShowAgentDeleteMenuItem({ canEdit: false, canManage: true })).toBe(false);
    expect(shouldShowAgentDeleteMenuItem({ canEdit: true, canManage: false })).toBe(false);
    expect(shouldShowAgentDeleteMenuItem({ canEdit: false, canManage: false })).toBe(false);
  });
});
