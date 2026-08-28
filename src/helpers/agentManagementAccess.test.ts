import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAgentManagementAccessCache,
  getRuntimeCanManageAgent,
  rememberAgentManagementAccess,
} from './agentManagementAccess';

describe('agentManagementAccess', () => {
  beforeEach(() => {
    clearAgentManagementAccessCache();
  });

  it('treats the author as managing without any resolved answer', () => {
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u1' }),
    ).toBe(true);
  });

  it('falls back to non-manager for an unresolved non-author', () => {
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u2' }),
    ).toBe(false);
  });

  it('promotes a non-author once the server confirmed management access', () => {
    rememberAgentManagementAccess('u2', 'a1', true);
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u2' }),
    ).toBe(true);
  });

  it('keeps a resolved non-manager answer non-managing', () => {
    rememberAgentManagementAccess('u2', 'a1', false);
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u2' }),
    ).toBe(false);
  });

  it('never lets one user inherit another user’s resolved answer', () => {
    rememberAgentManagementAccess('u2', 'a1', true);
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: 'u3' }),
    ).toBe(false);
  });

  it('ignores the cache entirely when the caller is unauthenticated', () => {
    rememberAgentManagementAccess('u2', 'a1', true);
    expect(
      getRuntimeCanManageAgent({ agentId: 'a1', agentUserId: 'u1', currentUserId: undefined }),
    ).toBe(false);
  });
});
