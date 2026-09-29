import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';

describe('tool hook context in the next LLM prompt', () => {
  it('projects persisted worker history once at tool authority through the complete engine', async () => {
    const messages = [
      { id: 'user', role: 'user', content: 'read file' },
      {
        id: 'assistant',
        role: 'assistant',
        content: '',
        tools: [
          { id: 'native', identifier: 'fs', apiName: 'read', arguments: '{}', type: 'builtin' },
        ],
      },
      {
        id: 'tool',
        role: 'tool',
        content: 'file content',
        tool_call_id: 'native',
        parentId: 'assistant',
        plugin: { identifier: 'fs', apiName: 'read', arguments: '{}', type: 'builtin' },
        pluginState: {
          hookPreparation: {
            additionalContexts: [{ hookId: 'control', text: 'ordinary guidance' }],
          },
        },
      },
    ] as UIChatMessage[];
    const run = () =>
      new MessagesEngine({
        messages: structuredClone(messages),
        model: 'gpt-4',
        provider: 'openai',
        enableSystemDate: false,
        capabilities: { isCanUseFC: () => true },
      }).process();
    const result = await run();
    expect(result.messages.filter(({ role }) => role === 'tool')).toEqual([
      expect.objectContaining({
        content:
          'file content\n\n<tool_hook_context hook="control">ordinary guidance</tool_hook_context>',
      }),
    ]);
    expect(
      result.messages
        .filter(({ role }) => role !== 'tool')
        .some(({ content }) => String(content).includes('ordinary guidance')),
    ).toBe(false);
    expect((await run()).messages).toEqual(result.messages);
    expect(messages[2].content).toBe('file content');
  });
});
