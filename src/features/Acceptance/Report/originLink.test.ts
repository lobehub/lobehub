import { describe, expect, it } from 'vitest';

import { originTopicHref } from './originLink';

describe('originTopicHref', () => {
  it('links to the agent topic route', () => {
    expect(originTopicHref({ agentId: 'agt_1', topicId: 'tpc_1' })).toBe('/agent/agt_1/tpc_1');
  });

  it('never falls back to the legacy /chat path, which redirects home', () => {
    expect(originTopicHref({ topicId: 'tpc_1' })).toBeUndefined();
    expect(originTopicHref(undefined)).toBeUndefined();
  });
});
