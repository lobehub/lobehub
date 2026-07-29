import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  trackCreateAgentModalCreationSucceeded,
  trackCreateAgentModalSkillSuggestionAction,
} from './createAgentModalAnalytics';

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

  it('tracks skill suggestion actions without prompt content', async () => {
    trackProductUsageEvent.mockResolvedValue(true);

    const tracked = await trackCreateAgentModalSkillSuggestionAction({
      action: 'install_succeeded',
      selectedSkillIdentifier: 'resume-reviewer',
      skillIdentifiers: ['resume-reviewer', 'cover-letter-writer'],
      source: 'manual',
    });

    expect(tracked).toBe(true);
    expect(trackProductUsageEvent).toHaveBeenCalledWith(
      {
        name: 'create_agent_modal_skill_suggestion_action',
        properties: {
          action: 'install_succeeded',
          selected_skill_identifier: 'resume-reviewer',
          skill_count: 2,
          source: 'manual',
          spm: 'home.create_agent_modal.skill_suggestion.install_succeeded',
          top_skill_identifier: 'resume-reviewer',
        },
      },
      { analytics: undefined },
    );
  });
});
