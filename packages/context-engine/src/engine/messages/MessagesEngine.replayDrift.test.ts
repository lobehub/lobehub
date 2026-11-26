import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { ContextProcessor } from '../../types';
import { contextReplayProcessorScope } from './contextReplay';
import { MessagesEngine } from './MessagesEngine';
import type { MessagesEngineParams } from './types';

const user = (id: string): UIChatMessage => ({ id, content: id, role: 'user' }) as UIChatMessage;
const base = (overrides: Partial<MessagesEngineParams> = {}): MessagesEngineParams => ({
  contextReplay: { invocationId: 'a1' },
  enableSystemDate: false,
  messages: [user('u1')],
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'Original persona',
  ...overrides,
});
const run = (overrides: Partial<MessagesEngineParams> = {}) =>
  new MessagesEngine(base(overrides)).process();
const plan = (goal: string) => ({
  completed: false,
  createdAt: '2026-11-01',
  description: 'release plan',
  goal,
  id: 'plan-1',
  updatedAt: '2026-11-01',
});
const continueAfter = async (
  first: Awaited<ReturnType<typeof run>>,
  overrides: Partial<MessagesEngineParams>,
) => {
  const previous = {
    id: 'a1',
    content: 'answer',
    role: 'assistant',
    metadata: { contextReplay: first.metadata.contextReplaySnapshot },
  } as UIChatMessage;
  return run({
    contextReplay: { invocationId: 'a2' },
    messages: [user('u1'), previous, user('u2')],
    ...overrides,
  });
};

describe('context replay drift', () => {
  it('replays first-user context exactly when retrying a committed invocation', async () => {
    const first = await run({ planTodo: { enabled: true, plan: plan('Ship v1') } });
    const retry = await run({
      contextReplay: {
        invocationId: 'a1',
        committedSnapshot: first.metadata.contextReplaySnapshot,
      },
      planTodo: { enabled: true, plan: plan('Ship v2') },
    });
    expect(retry.messages).toEqual(first.messages);
  });

  it('appends changed first-user context without rewriting the earlier prefix', async () => {
    const first = await run({ planTodo: { enabled: true, plan: plan('Ship v1') } });
    const next = await continueAfter(first, { planTodo: { enabled: true, plan: plan('Ship v2') } });
    expect(next.messages.slice(0, first.messages.length)).toEqual(first.messages);
    expect(JSON.stringify(next.messages.slice(first.messages.length))).toContain('Ship v2');
  });

  it('applies an edited system role after the stable baseline', async () => {
    const first = await run();
    const next = await continueAfter(first, { systemRole: 'Changed preference' });
    expect(next.messages[0]).toEqual(first.messages[0]);
    expect(JSON.stringify(next.messages.slice(first.messages.length))).toContain(
      'Changed preference',
    );
  });

  it.each(['before-system', 'system-append', 'system-replace'] as const)(
    'applies an edited %s document after the stable baseline',
    async (loadPosition) => {
      const doc = (content: string) => ({
        content,
        filename: 'rules.md',
        id: 'doc-1',
        loadPosition,
        policyLoad: 'always' as const,
        title: 'Rules',
      });
      const first = await run({ agentDocuments: [doc('ORIGINAL RULE')] });
      const next = await continueAfter(first, { agentDocuments: [doc('UPDATED RULE')] });
      expect(next.messages[0]).toEqual(first.messages[0]);
      expect(JSON.stringify(next.messages.slice(first.messages.length))).toContain('UPDATED RULE');
    },
  );

  it('classifies every pipeline processor for replay', () => {
    const engine = new MessagesEngine(base()) as unknown as {
      buildProcessors: () => ContextProcessor[];
    };
    const unclassified = engine
      .buildProcessors()
      .map((processor) => processor.name)
      .filter((name) => !contextReplayProcessorScope(name));
    expect(unclassified).toEqual([]);
  });
});
