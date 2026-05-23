import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackCreateAgentModalCreationSucceeded } from './createAgentModalAnalytics';

const trackProductUsageEvent = vi.hoisted(() => vi.fn());

vi.mock('@/libs/analytics/productUsageEvent', () => ({
  trackProductUsageEvent,
}));

describe('create agent modal analytics', () => {
  beforeEach(() => {
    trackProductUsageEvent.mockReset();
  });

  it('tracks agent submit source', async () => {
    trackProductUsageEvent.mockResolvedValue(true);

    const tracked = await trackCreateAgentModalCreationSucceeded({
      source: 'manual',
      type: 'agent',
    });

    expect(tracked).toBe(true);
    expect(trackProductUsageEvent).toHaveBeenCalledWith(
      {
        name: 'create_agent_modal_creation_succeeded',
        properties: {
          source: 'manual',
          spm: 'home.create_agent_modal.submit',
          type: 'agent',
        },
      },
      { analytics: undefined },
    );
  });

  it('does not track group submits with the agent event name', async () => {
    const tracked = await trackCreateAgentModalCreationSucceeded({
      source: 'manual',
      type: 'group',
    });

    expect(tracked).toBe(false);
    expect(trackProductUsageEvent).not.toHaveBeenCalled();
  });
});
