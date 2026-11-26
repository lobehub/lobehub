import { describe, expect, it } from 'vitest';

import { getAgentPublishErrorKey } from './publishError';

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
