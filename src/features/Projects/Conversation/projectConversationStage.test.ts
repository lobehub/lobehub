import { describe, expect, it } from 'vitest';

import { projectConversationStage } from './projectConversationStage';

const ready = {
  agentConfigLoading: false,
  chatAgentId: 'agt_cook',
  conversationAgentId: 'agt_cook',
  hasProject: true,
};

describe('projectConversationStage', () => {
  it('waits with the whole pane until the project and its agent are known', () => {
    expect(projectConversationStage({ ...ready, hasProject: false })).toBe('loading');
    expect(projectConversationStage({ ...ready, conversationAgentId: undefined })).toBe('loading');
  });

  it('renders the conversation once its agent is loaded and synced', () => {
    expect(projectConversationStage(ready)).toBe('ready');
  });

  /**
   * @example Switching to a topic of another agent swapped the whole workspace
   * for a spinner, so the header and composer blinked out before the
   * conversation mounted again.
   */
  it('keeps the workspace while a newly selected agent loads or syncs', () => {
    expect(
      projectConversationStage({
        ...ready,
        agentConfigLoading: true,
        chatAgentId: 'agt_sam',
        conversationAgentId: 'agt_sam',
      }),
    ).toBe('agentPending');
    expect(projectConversationStage({ ...ready, conversationAgentId: 'agt_sam' })).toBe(
      'agentPending',
    );
  });
});
