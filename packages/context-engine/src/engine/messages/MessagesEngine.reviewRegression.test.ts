import type { ContextReplaySnapshot, UIChatMessage } from '@lobechat/types';
import { expect, it } from 'vitest';

import { contextReplayMessageIds, withContextReplays } from '../../..';
import { MessagesEngine } from './MessagesEngine';
import type { MessagesEngineParams } from './types';

const user = (id: string) => ({ id, role: 'user', content: id }) as UIChatMessage;
const reply = (id: string, snapshot: ContextReplaySnapshot, content = 'visible answer') =>
  ({ id, role: 'assistant', content, metadata: { contextReplay: snapshot } }) as UIChatMessage;
const run = (id: string, messages: UIChatMessage[], extra: Partial<MessagesEngineParams> = {}) =>
  new MessagesEngine({
    model: 'gpt-4',
    provider: 'openai',
    systemRole: 'role',
    enableSystemDate: false,
    messages,
    contextReplay: { invocationId: id },
    ...extra,
  }).process();

it('isolates actor baselines and private increments while retaining shared replies', async () => {
  const group = {
    agentMap: {
      A: { name: 'A', role: 'participant' as const },
      B: { name: 'B', role: 'participant' as const },
    },
    currentAgentRole: 'participant' as const,
  };
  const first = await run('a1', [user('u1')], {
    systemRole: 'PERSONA_A',
    contextReplay: {
      invocationId: 'a1',
      sourceIdsByProvider: { PrivateInput: ['document:actor-a'] },
    },
    agentGroup: { ...group, currentAgentId: 'A' },
    additionalContexts: [
      {
        content: { type: 'text', text: 'PRIVATE_A' },
        placement: 'virtual_tail',
        wrapper: { tag: 'private' },
      },
    ],
  });
  const next = await run(
    'b1',
    [
      user('u1'),
      { ...reply('a1', first.metadata.contextReplaySnapshot!), agentId: 'A' },
      user('u2'),
    ],
    { systemRole: 'PERSONA_B', agentGroup: { ...group, currentAgentId: 'B' } },
  );
  expect(next.messages[0].content).toContain('PERSONA_B');
  expect(JSON.stringify(next.messages)).not.toContain('PRIVATE_A');
  expect(JSON.stringify(next.messages)).toContain('visible answer');
  expect(next.metadata.contextReplaySnapshot?.sourceIds).toContain('document:actor-a');
});
it('keeps a safe rebuilt turn available on the following turn', async () => {
  const old = await run('a1', [user('u1')]);
  const invalid = { ...old.metadata.contextReplaySnapshot!, invalidated: true };
  const second = await run('a2', [user('u1'), reply('a1', invalid, 'UNSAFE'), user('u2')]);
  const third = await run('a3', [
    user('u1'),
    reply('a1', invalid, 'UNSAFE'),
    user('u2'),
    reply('a2', second.metadata.contextReplaySnapshot!, 'SAFE SECOND ANSWER'),
    user('u3'),
  ]);
  expect(JSON.stringify(third.messages)).not.toContain('UNSAFE');
  expect(JSON.stringify(third.messages)).toContain('SAFE SECOND ANSWER');
});
it('does not retain a removed memory when other memories remain enabled', async () => {
  const memories = {
    contexts: [
      { id: 'old', description: 'DELETED MEMORY' },
      { id: 'live', description: 'LIVE MEMORY' },
    ],
    preferences: [],
    experiences: [],
  };
  const first = await run('a1', [user('u1')], { userMemory: { enabled: true, memories } });
  const next = await run(
    'a2',
    [user('u1'), reply('a1', first.metadata.contextReplaySnapshot!), user('u2')],
    {
      userMemory: { enabled: true, memories: { ...memories, contexts: [memories.contexts[1]] } },
      contextReplay: {
        invocationId: 'a2',
        validateSources: async (sources) =>
          sources.filter((source) => source === 'memory:contexts:old'),
      },
    },
  );
  expect(JSON.stringify(next.messages)).not.toContain('DELETED MEMORY');
  expect(JSON.stringify(next.messages)).toContain('LIVE MEMORY');
});
it('finds invocation dependencies through council members and grouped tasks', () => {
  const messages = [
    {
      id: 'council',
      role: 'agentCouncil',
      members: [{ id: 'a1', role: 'assistant', content: '' }],
    },
    { id: 'tasks', role: 'tasks', tasks: [{ id: 'task1', role: 'task', content: '' }] },
  ] as unknown as UIChatMessage[];
  expect(contextReplayMessageIds(messages)).toEqual(expect.arrayContaining(['a1', 'task1']));
  const snapshot: ContextReplaySnapshot = {
    version: 1,
    invocationId: 'a1',
    sessionKey: 'test',
    sourceIds: [],
    changes: [],
  };
  expect(
    (withContextReplays(messages, { a1: snapshot })[0] as any).members[0].metadata.contextReplay,
  ).toEqual(snapshot);
});

it('does not re-inject a stale current retrieval after live memory validation rejects it', async () => {
  const result = await run('a1', [user('u1')], {
    userMemory: {
      enabled: true,
      memories: {
        contexts: [{ id: 'deleted', description: 'STALE MEMORY' }],
        preferences: [],
        experiences: [],
      },
    },
    contextReplay: { invocationId: 'a1', validateSources: async (sources) => sources },
  });
  expect(JSON.stringify(result.messages)).not.toContain('STALE MEMORY');
});
