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

  it('orders by creation, keeping insertion order within the same millisecond', () => {
    const store = new LocalMessageStore();
    for (const content of ['a', 'b', 'c', 'd']) store.insert({ ...base, content });

    expect(store.query({ agentId: 'agent-1', topicId: 'topic-1' }).map((m) => m.content)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
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
