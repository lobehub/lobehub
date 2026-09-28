import { ThreadType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveNewThreadIntent } from './newThreadIntent';

describe('resolveNewThreadIntent', () => {
  const stagedSubtopic = {
    agentId: 'agt_1',
    isNew: true,
    scope: 'thread' as const,
    sourceMessageId: 'msg_1',
    threadType: ThreadType.Continuation,
    topicId: 'tpc_1',
  };

  it('reads the intent off a staged subtopic context', () => {
    expect(resolveNewThreadIntent(stagedSubtopic)).toEqual({
      sourceMessageId: 'msg_1',
      type: ThreadType.Continuation,
    });
  });

  it('returns nothing for a follow-up inside an existing thread', () => {
    // Re-creating the thread here would orphan every turn already inside it.
    expect(
      resolveNewThreadIntent({
        agentId: 'agt_1',
        scope: 'thread',
        threadId: 'thd_1',
        topicId: 'tpc_1',
      }),
    ).toBeUndefined();
  });

  it('returns nothing for a plain main-conversation send', () => {
    expect(resolveNewThreadIntent({ agentId: 'agt_1', topicId: 'tpc_1' })).toBeUndefined();
  });

  it.each([['sourceMessageId'], ['threadType']])(
    'returns nothing when a staged subtopic is missing %s',
    (field) => {
      expect(resolveNewThreadIntent({ ...stagedSubtopic, [field]: undefined })).toBeUndefined();
    },
  );

  it('ignores a new-TOPIC send that is not scoped to a thread', () => {
    // `isNew` alone means "creating a topic"; only `scope: 'thread'` stages a
    // subtopic. Branching on `isNew` would fork every first message into a thread.
    expect(
      resolveNewThreadIntent({ agentId: 'agt_1', isNew: true, sourceMessageId: 'msg_1' }),
    ).toBeUndefined();
  });
});
