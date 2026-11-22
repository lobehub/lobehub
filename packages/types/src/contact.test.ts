import { describe, expect, it } from 'vitest';

import { contactCardOf } from './contact';

const agentCard = {
  agentId: 'agt_1',
  avatar: null,
  backgroundColor: null,
  name: 'Writer',
  ownerName: 'Max',
  type: 'agent',
};

describe('contactCardOf', () => {
  it('reads an Agent card by its share, or a workspace card without one', () => {
    expect(contactCardOf({ card: { ...agentCard, shareId: 'shr_1' } })).toBeDefined();
    expect(
      contactCardOf({ card: { ...agentCard, shareId: null, workspaceId: 'ws_1' } }),
    ).toBeDefined();
  });

  it('drops an Agent card with neither', () => {
    expect(contactCardOf({ card: { ...agentCard, shareId: null } })).toBeUndefined();
  });
});
