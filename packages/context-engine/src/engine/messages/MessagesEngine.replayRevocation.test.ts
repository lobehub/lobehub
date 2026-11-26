import type { ContextReplaySnapshot, UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { MessagesEngine } from './MessagesEngine';
import type { MessagesEngineParams } from './types';

const user = (id: string): UIChatMessage => ({ id, content: id, role: 'user' }) as UIChatMessage;
const assistant = (snapshot?: ContextReplaySnapshot) =>
  ({
    id: 'a1',
    content: 'EARLIER ANSWER',
    role: 'assistant',
    metadata: { contextReplay: snapshot },
  }) as UIChatMessage;
const run = (overrides: Partial<MessagesEngineParams> = {}) =>
  new MessagesEngine({
    contextReplay: { invocationId: 'a1' },
    enableSystemDate: false,
    messages: [user('u1')],
    model: 'gpt-4',
    provider: 'openai',
    systemRole: 'role',
    ...overrides,
  }).process();
const webTool = {
  api: [{ description: 'search', name: 'search', parameters: { properties: {}, type: 'object' } }],
  identifier: 'web',
  meta: { title: 'Web' },
  systemRole: 'Use web search',
  type: 'builtin',
} as never;

describe('context replay after source changes', () => {
  it('keeps the conversation when a tool is no longer enabled', async () => {
    const first = await run({ toolsConfig: { manifests: [webTool] } });
    expect(first.metadata.contextReplaySnapshot?.sourceIds).toContain('tool:web');
    const next = await run({
      contextReplay: { invocationId: 'a2' },
      messages: [user('u1'), assistant(first.metadata.contextReplaySnapshot), user('u2')],
    });
    const rendered = JSON.stringify(next.messages);
    expect(rendered).toContain('EARLIER ANSWER');
    expect(rendered).toContain('"u1"');
  });

  it('withholds a deleted memory without dropping the conversation', async () => {
    const first = await run();
    const snapshot: ContextReplaySnapshot = {
      ...first.metadata.contextReplaySnapshot!,
      changes: [
        {
          key: 'UserMemoryInjector',
          messages: [{ content: 'LIKES GREEN TEA', id: 'memory-0', role: 'user' }],
          sourceIds: ['memory:preferences:m1'],
        },
      ],
      sourceIds: ['memory:preferences:m1'],
    };
    const next = await run({
      contextReplay: {
        invocationId: 'a2',
        validateSources: async (ids) => ids.filter((id) => id.startsWith('memory:')),
      },
      messages: [user('u1'), assistant(snapshot), user('u2')],
    });
    const rendered = JSON.stringify(next.messages);
    expect(rendered).not.toContain('LIKES GREEN TEA');
    expect(rendered).toContain('EARLIER ANSWER');
  });

  it('fails the invocation instead of truncating history when source checks error', async () => {
    const first = await run({ toolsConfig: { manifests: [webTool] } });
    await expect(
      run({
        contextReplay: {
          invocationId: 'a2',
          validateSources: async () => {
            throw new Error('database unavailable');
          },
        },
        messages: [user('u1'), assistant(first.metadata.contextReplaySnapshot), user('u2')],
        toolsConfig: { manifests: [webTool] },
      }),
    ).rejects.toThrow('database unavailable');
  });

  it('does not carry a withheld memory into the next dependencies', async () => {
    const first = await run();
    const snapshot: ContextReplaySnapshot = {
      ...first.metadata.contextReplaySnapshot!,
      changes: [
        {
          key: 'UserMemoryInjector',
          messages: [{ content: 'LIKES GREEN TEA', id: 'memory-0', role: 'user' }],
          sourceIds: ['memory:preferences:m1'],
        },
      ],
      sourceIds: ['memory:preferences:m1'],
    };
    const next = await run({
      contextReplay: {
        invocationId: 'a2',
        validateSources: async (ids) => ids.filter((id) => id.startsWith('memory:')),
      },
      messages: [user('u1'), assistant(snapshot), user('u2')],
    });
    expect(next.metadata.contextReplaySnapshot?.sourceIds).not.toContain('memory:preferences:m1');
  });

  it('retries a committed invocation without the text of a deleted memory', async () => {
    const first = await run();
    const committed: ContextReplaySnapshot = {
      ...first.metadata.contextReplaySnapshot!,
      changes: [
        {
          key: 'UserMemoryInjector',
          messages: [{ content: 'LIKES GREEN TEA', id: 'memory-0', role: 'user' }],
          sourceIds: ['memory:preferences:m1'],
        },
      ],
      sourceIds: ['memory:preferences:m1'],
    };
    const retry = await run({
      contextReplay: {
        committedSnapshot: committed,
        invocationId: 'a1',
        validateSources: async (ids) => ids.filter((id) => id.startsWith('memory:')),
      },
    });
    expect(JSON.stringify(retry.messages)).not.toContain('LIKES GREEN TEA');
  });
});
