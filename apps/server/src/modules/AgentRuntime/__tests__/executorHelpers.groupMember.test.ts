import { describe, expect, it } from 'vitest';

import { resolveGroupMemberId } from '../executorHelpers';

describe('resolveGroupMemberId', () => {
  const agentMap = {
    agt_member: { name: 'Meituan Assistant' },
    agt_supervisor: { name: 'Supervisor' },
  };

  it('keeps a persisted agent id unchanged', () => {
    expect(resolveGroupMemberId('agt_member', agentMap)).toBe('agt_member');
  });

  it('resolves an exact member display name to its persisted agent id', () => {
    expect(resolveGroupMemberId('Meituan Assistant', agentMap)).toBe('agt_member');
  });

  it('does not guess when a display name is ambiguous', () => {
    expect(
      resolveGroupMemberId('Assistant', {
        agt_first: { name: 'Assistant' },
        agt_second: { name: 'Assistant' },
      }),
    ).toBe('Assistant');
  });
});
