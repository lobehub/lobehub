import { describe, expect, it } from 'vitest';

import { contactCardText } from './contactCard';

const owner = { avatar: null, fullName: 'Arvin', id: 'u1', username: 'arvin' };

describe('contactCardText', () => {
  it('names a person with their handle when it differs from their name', () => {
    expect(contactCardText({ type: 'user', user: { ...owner, fullName: 'Max' } })).toBe(
      '[Contact card] Max (@arvin)',
    );
    expect(contactCardText({ type: 'user', user: { ...owner, fullName: null } })).toBe(
      '[Contact card] arvin',
    );
    expect(
      contactCardText({ type: 'user', user: { ...owner, fullName: ' ', username: null } }),
    ).toBe('[Contact card] Someone');
  });

  it('names an Agent with its owner', () => {
    const agent = {
      agentId: 'agt',
      avatar: null,
      backgroundColor: null,
      description: null,
      owner,
      shareId: 's',
      slug: null,
      title: 'Writer',
    };
    expect(contactCardText({ agent, type: 'agent' })).toBe('[Agent card] Writer, by Arvin');
    expect(
      contactCardText({
        agent: { ...agent, owner: { ...owner, fullName: null, username: null }, title: null },
        type: 'agent',
      }),
    ).toBe('[Agent card] Agent');
  });
});
