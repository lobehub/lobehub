// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { getAgentPublishErrorKey, shouldShowAgentDeleteMenuItem } from './agentMenuVisibility';

describe('getAgentPublishErrorKey', () => {
  it('maps the fixed private-device precondition to actionable publish copy', () => {
    expect(
      getAgentPublishErrorKey({
        data: { errorData: { code: 'FixedAgentRequiresPublicWorkspaceDevice' } },
      }),
    ).toBe('agent.publishToWorkspaceErrorFixedPrivateDevice');
  });

  it('keeps unrelated publish failures on the generic fallback', () => {
    expect(getAgentPublishErrorKey({ data: { code: 'FORBIDDEN' } })).toBeUndefined();
    expect(getAgentPublishErrorKey(new Error('network failure'))).toBeUndefined();
  });
});

describe('shouldShowAgentDeleteMenuItem', () => {
  it('shows Delete only when the agent can be edited and managed', () => {
    expect(shouldShowAgentDeleteMenuItem({ canEdit: true, canManage: true })).toBe(true);
    expect(shouldShowAgentDeleteMenuItem({ canEdit: false, canManage: true })).toBe(false);
    expect(shouldShowAgentDeleteMenuItem({ canEdit: true, canManage: false })).toBe(false);
    expect(shouldShowAgentDeleteMenuItem({ canEdit: false, canManage: false })).toBe(false);
  });
});
