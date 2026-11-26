import { RequestTrigger } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildUserTurnMetadata } from './userTurnMetadata';

describe('buildUserTurnMetadata', () => {
  it('stores only the trigger for an ordinary chat turn', () => {
    expect(buildUserTurnMetadata({ trigger: RequestTrigger.Chat })).toEqual({
      trigger: RequestTrigger.Chat,
    });
  });

  it('drops a trigger outside RequestTrigger', () => {
    expect(buildUserTurnMetadata({ trigger: 'not-a-trigger' })).toEqual({});
  });

  it('persists the selected skills once each, so later turns can read them back', () => {
    expect(
      buildUserTurnMetadata({
        selectedSkillIds: ['ux-audit', 'agent-skills:review', 'ux-audit'],
        trigger: RequestTrigger.Chat,
      }),
    ).toEqual({
      selectedSkillIds: ['ux-audit', 'agent-skills:review'],
      trigger: RequestTrigger.Chat,
    });
  });

  it('omits an empty skill selection', () => {
    expect(buildUserTurnMetadata({ selectedSkillIds: [] })).not.toHaveProperty('selectedSkillIds');
  });

  it('persists the selected tools and agent-mention tool once each for later turns', () => {
    expect(
      buildUserTurnMetadata({
        hasMentionedAgents: true,
        selectedToolIds: ['lobe-web-browsing', 'xmind', 'lobe-web-browsing'],
        trigger: RequestTrigger.Chat,
      }),
    ).toEqual({
      selectedToolIds: ['lobe-web-browsing', 'xmind', 'lobe-agent-management'],
      trigger: RequestTrigger.Chat,
    });
  });

  it('omits an empty tool selection when no agents are mentioned', () => {
    expect(
      buildUserTurnMetadata({ hasMentionedAgents: false, selectedToolIds: [] }),
    ).not.toHaveProperty('selectedToolIds');
  });
});
