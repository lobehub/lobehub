import { describe, expect, it } from 'vitest';

import { type ComposerMember, composerRecipients } from './recipients';

const member = (id: string, actorType: ComposerMember['actorType'] = 'agent') => ({
  actorType,
  avatar: '',
  id,
  name: id,
});

describe('composerRecipients', () => {
  const members = [member('analyst'), member('coder'), member('alice', 'user')];
  const ids = (result: ReturnType<typeof composerRecipients>) => result.agents.map((a) => a.id);

  it('previews every Agent on the main conversation when nobody is mentioned', () => {
    const result = composerRecipients({
      defaultRecipientIds: ['analyst', 'coder'],
      inThread: false,
      members,
      mentionIds: [],
    });
    expect(result.kind).toBe('all');
    expect(ids(result)).toEqual(['analyst', 'coder']);
  });

  it('names a single default Agent instead of calling it everyone', () => {
    const result = composerRecipients({
      defaultRecipientIds: ['analyst'],
      inThread: false,
      members,
      mentionIds: [],
    });
    expect(result.kind).toBe('named');
    expect(ids(result)).toEqual(['analyst']);
  });

  it('narrows to the mentioned Agents', () => {
    const result = composerRecipients({
      defaultRecipientIds: ['analyst', 'coder'],
      inThread: false,
      members,
      mentionIds: ['coder', 'alice'],
    });
    expect(result.kind).toBe('named');
    expect(ids(result)).toEqual(['coder']);
  });

  it('lists mentioned Agents in the order they were mentioned', () => {
    const result = composerRecipients({
      defaultRecipientIds: [],
      inThread: false,
      members,
      mentionIds: ['coder', 'analyst'],
    });
    expect(ids(result)).toEqual(['coder', 'analyst']);
  });

  it('warns that mentioning only people wakes no Agent', () => {
    const result = composerRecipients({
      defaultRecipientIds: ['analyst', 'coder'],
      inThread: false,
      members,
      mentionIds: ['alice'],
    });
    expect(result).toEqual({ agents: [], kind: 'peopleOnly' });
  });

  it('uses Thread followers, and asks for a mention when there are none', () => {
    expect(
      ids(
        composerRecipients({
          defaultRecipientIds: ['coder'],
          inThread: true,
          members,
          mentionIds: [],
        }),
      ),
    ).toEqual(['coder']);
    expect(
      composerRecipients({ defaultRecipientIds: [], inThread: true, members, mentionIds: [] }).kind,
    ).toBe('noFollowers');
  });
});
