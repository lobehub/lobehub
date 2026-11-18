import { describe, expect, it } from 'vitest';

import { channelsInScope } from './channelScope';

const channels = [
  { agentId: null, id: 'standalone', projectId: null },
  { agentId: null, id: 'launch', projectId: 'pro_1' },
  { agentId: null, id: 'other', projectId: 'pro_2' },
  // Cached before the list carried a project.
  { agentId: null, id: 'legacy', projectId: undefined as unknown as null },
  // A 1:1 conversation with an Agent.
  { agentId: 'agt_1', id: 'direct', projectId: null },
];

describe('channelsInScope', () => {
  it('lists only the project’s own Channels inside a project', () => {
    expect(channelsInScope(channels, 'pro_1')?.map((c) => c.id)).toEqual(['launch']);
  });

  it('keeps project Channels out of the home list', () => {
    expect(channelsInScope(channels)?.map((c) => c.id)).toEqual(['standalone', 'legacy']);
  });

  it('waits for the list to load', () => {
    expect(channelsInScope(undefined, 'pro_1')).toBeUndefined();
  });
});
