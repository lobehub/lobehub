import type { ContextReplaySnapshot, UIChatMessage } from '@lobechat/types';
import { afterEach, expect, it, vi } from 'vitest';

import { MessagesEngine } from './MessagesEngine';
import type { MessagesEngineParams } from './types';

const user = (id: string) => ({ id, role: 'user', content: id }) as UIChatMessage;
const run = (id: string, messages: UIChatMessage[], options: Partial<MessagesEngineParams> = {}) =>
  new MessagesEngine({
    messages,
    model: 'gpt-4',
    provider: 'openai',
    systemRole: 'persona',
    enableSystemDate: false,
    contextReplay: { invocationId: id },
    ...options,
  }).process();
const answer = (id: string, snapshot: ContextReplaySnapshot) =>
  ({
    id,
    content: 'answer',
    role: 'assistant',
    metadata: { contextReplay: snapshot },
  }) as UIChatMessage;
afterEach(() => vi.useRealTimers());

it('keeps a Goal pair at its original position and appends only a changed overview', async () => {
  const overview = {
    findings: [],
    goal: { title: 'Goal', status: 'running' },
    pendingDecisions: [],
    tasks: [],
  };
  const first = await run('a1', [user('u1')], { initialContext: { goalOverview: overview } });
  const history = [user('u1'), answer('a1', first.metadata.contextReplaySnapshot!), user('u2')];
  const next = await run('a2', history, { initialContext: { goalOverview: overview } });
  expect(next.messages.slice(0, first.messages.length)).toEqual(first.messages);
  expect(next.metadata.contextReplaySnapshot!.changes).toHaveLength(0);
  const changed = await run('a2', history, {
    initialContext: { goalOverview: { ...overview, findings: ['new finding'] } },
  });
  expect(changed.messages.slice(0, first.messages.length)).toEqual(first.messages);
  expect(JSON.stringify(changed.messages.slice(first.messages.length))).toContain('new finding');
});

it('adds one date update after a complete parallel tool batch without a new user message', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-25T15:59:00Z'));
  const first = await run('a1', [user('u1')], {
    enableSystemDate: true,
    timezone: 'Asia/Singapore',
  });
  const assistant = {
    ...answer('a1', first.metadata.contextReplaySnapshot!),
    tools: ['c1', 'c2'].map((id) => ({
      id,
      identifier: 'tool',
      apiName: 'read',
      arguments: '{}',
      type: 'builtin',
    })),
  } as UIChatMessage;
  const results = ['c1', 'c2'].map(
    (id) => ({ id: `t_${id}`, role: 'tool', content: 'done', tool_call_id: id }) as UIChatMessage,
  );
  vi.setSystemTime(new Date('2026-11-25T16:01:00Z'));
  const second = await run('a2', [user('u1'), assistant, ...results], {
    enableSystemDate: true,
    timezone: 'Asia/Singapore',
  });
  const dateIndex = second.messages.findIndex((message) =>
    JSON.stringify(message.content).includes('2026-11-26'),
  );
  expect(dateIndex).toBeGreaterThan(
    second.messages.findIndex((message) => message.tool_call_id === 'c2'),
  );
  const third = await run(
    'a3',
    [user('u1'), assistant, ...results, answer('a2', second.metadata.contextReplaySnapshot!)],
    { enableSystemDate: true, timezone: 'Asia/Singapore' },
  );
  expect(third.metadata.contextReplaySnapshot!.changes).toHaveLength(0);
});

it('resolves tool placeholders before committing them and never rerenders historical values', async () => {
  const options = {
    toolsConfig: {
      tools: ['test'],
      manifests: [
        { identifier: 'test', api: [], systemRole: 'directory: {{dir}}', type: 'builtin' as const },
      ],
    },
  };
  const first = await run('a1', [user('u1')], {
    ...options,
    variableGenerators: { dir: () => '/old' },
  });
  expect(JSON.stringify(first.messages)).toContain('/old');
  expect(JSON.stringify(first.messages)).not.toContain('{{dir}}');
  const next = await run(
    'a2',
    [user('u1'), answer('a1', first.metadata.contextReplaySnapshot!), user('u2')],
    { ...options, variableGenerators: { dir: () => '/new' } },
  );
  expect(next.messages.slice(0, first.messages.length)).toEqual(first.messages);
  expect(JSON.stringify(next.messages.slice(first.messages.length))).toContain('/new');
});

it('keeps invocation ownership when an assistant group is flattened', async () => {
  const first = await run('a1', [user('u1')]);
  const next = await run(
    'a2',
    [
      user('u1'),
      {
        id: 'group',
        role: 'assistantGroup',
        content: '',
        children: [answer('a1', first.metadata.contextReplaySnapshot!)],
      } as UIChatMessage,
      user('u2'),
    ],
    { systemRole: 'new preference' },
  );
  expect(next.messages[0]).toEqual(first.messages[0]);
});

it('freezes a message reference and does not attach it to a later user turn', async () => {
  const u1 = { ...user('u1'), content: '<refer_document id="docs_a" />' };
  const first = await run('a1', [u1], {
    documentReferences: [{ documentId: 'docs_a', content: 'ORIGINAL BODY' }],
  });
  const history = [u1, answer('a1', first.metadata.contextReplaySnapshot!)];
  const toolStep = await run('a2', history, {
    documentReferences: [{ documentId: 'docs_a', content: 'CHANGED BODY' }],
  });
  expect(toolStep.metadata.contextReplaySnapshot!.changes).toHaveLength(0);
  const followUp = await run('a2', [...history, user('u2')], {
    documentReferences: [{ documentId: 'docs_a', content: 'CHANGED BODY', earlierTurn: true }],
  });
  expect(JSON.stringify(followUp.messages)).not.toContain('CHANGED BODY');
  expect(followUp.metadata.contextReplaySnapshot!.changes).toHaveLength(0);
});
