import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { describe, expect, it } from 'vitest';

import { resolveInboxAgentRouteId } from './useResolvedAgentRouteId';

describe('resolveInboxAgentRouteId', () => {
  it('should use the stable inbox slug while the persisted agent ID is loading', () => {
    expect(resolveInboxAgentRouteId()).toBe(BUILTIN_AGENT_SLUGS.inbox);
  });

  it('should use the persisted agent ID after initialization', () => {
    expect(resolveInboxAgentRouteId('inbox-agent-id')).toBe('inbox-agent-id');
  });
});
