import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '.';

const analyticsTrack = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/analytics', () => ({
  getSingletonAnalyticsOptional: () => ({ track: analyticsTrack }),
}));

describe('AgentSetting actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tracks metadata changes without sending identity or metadata values', async () => {
    const agentSettingStore = createStore();
    agentSettingStore.setState({ id: 'private-agent-id' });

    await agentSettingStore.getState().setAgentMeta({
      avatar: 'private-avatar',
      description: 'Private Agent Description',
      tags: ['private-tag'],
      title: 'Private Agent Name',
    });

    expect(analyticsTrack).toHaveBeenCalledWith({
      name: 'agent_meta_updated',
      properties: { is_inbox: false },
    });

    const analyticsPayload = JSON.stringify(analyticsTrack.mock.calls);
    expect(analyticsPayload).not.toContain('private-agent-id');
    expect(analyticsPayload).not.toContain('private-avatar');
    expect(analyticsPayload).not.toContain('Private Agent Description');
    expect(analyticsPayload).not.toContain('private-tag');
    expect(analyticsPayload).not.toContain('Private Agent Name');
  });
});
