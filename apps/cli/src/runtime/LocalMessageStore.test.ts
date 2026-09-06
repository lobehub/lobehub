import { describe, expect, it } from 'vitest';

import { LocalMessageStore } from './LocalMessageStore';

const base = { agentId: 'agent-1', content: 'x', role: 'assistant' as const, topicId: 'topic-1' };

describe('LocalMessageStore query scoping', () => {
  it('treats an absent filter as IS NULL, not as "any"', () => {
    const store = new LocalMessageStore();
    store.insert({ ...base, threadId: null });
    store.insert({ ...base, content: 'in-thread', threadId: 'thread-1' });

    // Mirrors `matchThread(undefined)` → `isNull(messages.threadId)`. Treating
    // it as "any" would fold thread messages into a mainline read and hand the
    // model a conversation the server would never have produced.
    const mainline = store.query({ agentId: 'agent-1', topicId: 'topic-1' });
    expect(mainline).toHaveLength(1);
    expect(mainline[0].content).toBe('x');

    const thread = store.query({ agentId: 'agent-1', threadId: 'thread-1', topicId: 'topic-1' });
    expect(thread).toHaveLength(1);
    expect(thread[0].content).toBe('in-thread');
  });

  it('excludes rows outside the requested topic', () => {
    const store = new LocalMessageStore();
    store.insert(base);
    store.insert({ ...base, content: 'other', topicId: 'topic-2' });

    expect(store.query({ agentId: 'agent-1', topicId: 'topic-1' })).toHaveLength(1);
  });

  it('filters a group read on groupId alone', () => {
    const store = new LocalMessageStore();
    store.insert({ ...base, agentId: 'member-a', groupId: 'group-1' });
    store.insert({ ...base, agentId: 'member-b', groupId: 'group-1' });

    // Members share the group but carry different agentIds — adding agentId to
    // a group read would drop every member row but one.
    expect(store.query({ agentId: 'member-a', groupId: 'group-1', topicId: 'topic-1' })).toHaveLength(2);
  });

  it('keeps delegated-agent replies in a concrete-topic read', () => {
    const store = new LocalMessageStore();
    store.insert(base, 'id-a');
    store.insert({ ...base, agentId: 'delegate-9', content: 'callAgent reply' }, 'id-b');

    // A concrete topic IS the conversation boundary and may legitimately hold
    // messages from several agents. Scoping a topic read by agentId deletes
    // delegated turns from the model's context — silently, and only on device.
    const messages = store.query({ agentId: 'agent-1', topicId: 'topic-1' });
    expect(messages.map((m) => m.content)).toEqual(['x', 'callAgent reply']);
  });

  it('still requires agent scope for an inbox read with no topic', () => {
    const store = new LocalMessageStore();
    store.insert({ ...base, topicId: undefined });
    store.insert({ ...base, agentId: 'other-agent', content: 'not mine', topicId: undefined });

    expect(store.query({ agentId: 'agent-1' }).map((m) => m.content)).toEqual(['x']);
  });

  it('excludes group messages from a plain topic read', () => {
    const store = new LocalMessageStore();
    store.insert(base);
    store.insert({ ...base, content: 'in a group', groupId: 'group-1' });

    // `matchGroup(undefined)` is `isNull(groupId)` on the server.
    expect(store.query({ topicId: 'topic-1' }).map((m) => m.content)).toEqual(['x']);
  });

  it('returns a thread together with its parent messages', () => {
    const store = new LocalMessageStore();
    const parent = store.insert({ ...base, content: 'the message the thread hangs off' }, 'id-a');
    store.insert({ ...base, content: 'in thread', threadId: 'thread-1' }, 'id-b');
    store.registerThreadParents('thread-1', [parent.id]);

    // The server resolves the thread's source message and returns it alongside
    // the thread rows. Without the parents a device-hosted thread starts the
    // model mid-conversation.
    const messages = store.query({ agentId: 'agent-1', threadId: 'thread-1', topicId: 'topic-1' });
    expect(messages.map((m) => m.content)).toEqual([
      'the message the thread hangs off',
      'in thread',
    ]);
  });

  it('falls back to exact thread matching when no parents were registered', () => {
    const store = new LocalMessageStore();
    store.insert({ ...base, content: 'parent' });
    store.insert({ ...base, content: 'in thread', threadId: 'thread-1' });

    // Mirrors the server's own fallback for a thread with no source message.
    expect(
      store.query({ threadId: 'thread-1', topicId: 'topic-1' }).map((m) => m.content),
    ).toEqual(['in thread']);
  });

  it('breaks a timestamp tie by id, not by arrival order', () => {
    const store = new LocalMessageStore();
    // Inserted out of id order, all in the same millisecond — what a parallel
    // tool batch produces.
    store.insert({ ...base, content: 'third' }, 'id-c');
    store.insert({ ...base, content: 'first' }, 'id-a');
    store.insert({ ...base, content: 'second' }, 'id-b');

    // `queryWithWhere` orders `(createdAt, id)`. Ordering by arrival instead
    // would feed the next LLM step a different sequence than the persisted
    // transcript — and a different one again after a restart re-hydrates them.
    expect(store.query({ topicId: 'topic-1' }).map((m) => m.content)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('survives a rehydration in the same order', () => {
    const first = new LocalMessageStore();
    first.insert({ ...base, content: 'b' }, 'id-b');
    first.insert({ ...base, content: 'a' }, 'id-a');
    const before = first.query({ topicId: 'topic-1' });

    // Hydrated in the opposite order, as a fresh process reading them back.
    const second = new LocalMessageStore();
    second.hydrate([...before].reverse());

    expect(second.query({ topicId: 'topic-1' }).map((m) => m.id)).toEqual(
      before.map((m) => m.id),
    );
  });
});

describe('LocalMessageStore pagination', () => {
  const fill = (store: LocalMessageStore, count: number) => {
    for (let index = 0; index < count; index++) {
      // Zero-padded so id order matches creation order.
      store.insert({ ...base, content: `m${index}` }, `id-${String(index).padStart(4, '0')}`);
    }
  };

  it('returns the newest page, not everything, at the canonical default', () => {
    const store = new LocalMessageStore();
    fill(store, 1200);

    const messages = store.query({ topicId: 'topic-1' });

    // `MessageModel.query` defaults to the newest 1,000 rows. Returning all
    // 1,200 would give the device a wider context than the server ever has,
    // and grow every per-step re-query without bound.
    expect(messages).toHaveLength(1000);
    expect(messages[0].content).toBe('m200');
    expect(messages.at(-1)?.content).toBe('m1199');
  });

  it('honours an explicit page size and offset from the newest end', () => {
    const store = new LocalMessageStore();
    fill(store, 10);

    expect(store.query({ pageSize: 3, topicId: 'topic-1' }).map((m) => m.content)).toEqual([
      'm7',
      'm8',
      'm9',
    ]);
    // `current: 1` is the page before the newest one.
    expect(
      store.query({ current: 1, pageSize: 3, topicId: 'topic-1' }).map((m) => m.content),
    ).toEqual(['m4', 'm5', 'm6']);
  });

  it('returns nothing past the last page', () => {
    const store = new LocalMessageStore();
    fill(store, 5);

    expect(store.query({ current: 5, pageSize: 3, topicId: 'topic-1' })).toEqual([]);
  });
});

describe('LocalMessageStore writes', () => {
  it('returns the existing row when a step is redelivered under the same key', () => {
    const store = new LocalMessageStore();
    const first = store.insert({ ...base, clientId: 'step-7' });
    const second = store.insert({ ...base, clientId: 'step-7', content: 'retry' });

    expect(second.id).toBe(first.id);
    expect(store.size).toBe(1);
    // The first write wins, matching the server's conflict path which returns
    // the persisted row rather than overwriting it.
    expect(second.content).toBe('x');
  });

  it('scopes the tool-call lookup to the assistant that made the call', () => {
    const store = new LocalMessageStore();
    const parentA = store.insert({ ...base, content: 'turn A' });
    const parentB = store.insert({ ...base, content: 'turn B' });
    const rowA = store.insert({
      ...base,
      content: 'result A',
      parentId: parentA.id,
      role: 'tool',
      tool_call_id: 'reused-id',
    } as never);
    store.insert({
      ...base,
      content: 'result B',
      parentId: parentB.id,
      role: 'tool',
      tool_call_id: 'reused-id',
    } as never);

    // `tool_call_id` is provider-supplied and can repeat across turns, so an
    // unscoped match would resolve to the wrong row — and this lookup feeds a write.
    expect(store.findToolMessageIdByToolCallId('reused-id', parentA.id)).toBe(rowA.id);
    expect(store.findToolMessageIdByToolCallId('reused-id', 'no-such-parent')).toBeUndefined();
  });

  it('merges plugin state rather than replacing it', () => {
    const store = new LocalMessageStore();
    const row = store.insert({ ...base, role: 'tool' });

    store.updatePluginState(row.id, { phase: 'running' });
    store.updatePluginState(row.id, { progress: 0.5 });

    // A tool reporting progress incrementally relies on earlier keys surviving.
    expect(store.get(row.id)?.pluginState).toEqual({ phase: 'running', progress: 0.5 });
  });

  it('patches metadata instead of replacing it', () => {
    const store = new LocalMessageStore();
    const row = store.insert({ ...base, metadata: { operationId: 'op-1', tps: 12 } } as never);

    store.update(row.id, { metadata: { totalTokens: 40 } } as never);

    // A `call_llm` step stamps provenance up front and finalizes with a second,
    // partial metadata write — a shallow spread would drop `operationId`, which
    // the cloud replica would still have.
    expect(store.get(row.id)?.metadata).toEqual({
      operationId: 'op-1',
      totalTokens: 40,
      tps: 12,
    });
  });

  it('forgets the idempotency key when the row is deleted', () => {
    const store = new LocalMessageStore();
    const first = store.insert({ ...base, clientId: 'step-7' });
    store.delete(first.id);

    // Otherwise the key would resolve to a row that no longer exists and the
    // re-created message would be silently dropped.
    const second = store.insert({ ...base, clientId: 'step-7' });
    expect(second.id).not.toBe(first.id);
    expect(store.size).toBe(1);
  });
});
