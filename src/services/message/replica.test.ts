import { describe, expect, it } from 'vitest';

import { cacheScope, isReplicaSyncKey } from '@/libs/replica';

import { conversationMessagesKey, conversationMessagesResource } from './replica';

const syncKeyOf = conversationMessagesResource.syncKey!;

describe('conversationMessagesResource sync key', () => {
  const topic = { agentId: 'agt-1', topicId: 'tpc-1' };

  it('is one sync per conversation, whatever the fetch-only options', () => {
    // ChatList mounts with `syncInterventions`, a share / portal view of the
    // same conversation without it: both must share one read.
    expect(syncKeyOf({ ...topic, syncInterventions: true })).toEqual(syncKeyOf(topic));
    expect(syncKeyOf({ ...topic, scope: 'main' })).toEqual(syncKeyOf(topic));
  });

  it('keeps conversations apart', () => {
    expect(syncKeyOf(topic)).not.toEqual(syncKeyOf({ ...topic, topicId: 'tpc-2' }));
    expect(syncKeyOf(topic)).not.toEqual(syncKeyOf({ ...topic, threadId: 'thd-1' }));
  });

  it('is a replica sync key of the entry, outside the SWR `message:` tier', () => {
    const key = syncKeyOf({ ...topic, syncInterventions: true });

    expect(key[0]).toBe('replica:sync');
    expect(
      isReplicaSyncKey(key, conversationMessagesResource.name, {
        key: conversationMessagesKey(topic),
        scope: cacheScope.get(),
      }),
    ).toBe(true);
    // The conversation stays last, for the predicate revalidation.
    expect(key[5]).toMatchObject(topic);
    expect(key[5]).not.toHaveProperty('syncInterventions');
  });
});
