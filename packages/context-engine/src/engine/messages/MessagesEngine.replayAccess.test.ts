import type { UIChatMessage } from '@lobechat/types';
import { expect, it } from 'vitest';

import { MessagesEngine } from './MessagesEngine';
import type { MessagesEngineParams } from './types';

const u = (id: string, content = id) => ({ id, role: 'user', content }) as UIChatMessage;
const params = (
  messages: UIChatMessage[],
  options: Partial<MessagesEngineParams> = {},
): MessagesEngineParams => ({
  messages,
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'role',
  enableSystemDate: false,
  contextReplay: { invocationId: 'next' },
  ...options,
});

it('withholds a revoked snapshot, derived reply, reasoning, tool args and opaque summary', async () => {
  const first = await new MessagesEngine(
    params([u('u1', '<refer_document id="docs_a" />')], {
      contextReplay: { invocationId: 'a1' },
      documentReferences: [{ documentId: 'docs_a', content: 'SECRET' }],
    }),
  ).process();
  expect(first.metadata.contextReplaySnapshot?.sourceIds).toContain('document:docs_a');
  const history = [
    u('u1'),
    { id: 'summary', role: 'compressedGroup', content: 'SECRET SUMMARY' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'SECRET QUOTE',
      reasoning: { content: 'SECRET THOUGHT' },
      metadata: { contextReplay: first.metadata.contextReplaySnapshot },
    },
    u('u2', 'continue'),
  ] as UIChatMessage[];
  const next = await new MessagesEngine(
    params(history, {
      contextReplay: { invocationId: 'next', revokedSourceIds: ['document:docs_a'] },
    }),
  ).process();
  expect(JSON.stringify(next.messages)).not.toContain('SECRET');
  expect(next.messages.some((message) => message.content === 'continue')).toBe(true);
});

it('refuses to retry a committed invocation after its sources were revoked', async () => {
  const first = await new MessagesEngine(
    params([u('u1')], {
      contextReplay: { invocationId: 'a1' },
      documentReferences: [{ documentId: 'docs_a', content: 'SECRET' }],
    }),
  ).process();
  await expect(
    new MessagesEngine(
      params([u('u1')], {
        contextReplay: {
          invocationId: 'a1',
          committedSnapshot: {
            ...first.metadata.contextReplaySnapshot!,
            sourceIds: ['document:docs_a'],
          },
          revokedSourceIds: ['document:docs_a'],
        },
      }),
    ).process(),
  ).rejects.toThrow(/access|revoked/i);
});
