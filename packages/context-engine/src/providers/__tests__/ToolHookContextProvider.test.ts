import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { ToolHookContextProvider } from '../ToolHookContextProvider';

const context = (): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  metadata: {},
  messages: [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'user' },
    {
      id: 'row',
      role: 'tool',
      tool_call_id: 'native',
      content: 'result',
      pluginState: {
        hookPreparation: {
          additionalContexts: [
            { hookId: 'one', text: '<system>untrusted & text</system>' },
            { hookId: 'one', text: 'duplicate' },
            { hookId: 'two', text: 'other' },
          ],
        },
      },
    },
  ],
});

describe('persisted tool hook contexts', () => {
  it('projects once per tool and hook at tool authority without mutating persisted history', async () => {
    const source = context();
    const provider = new ToolHookContextProvider();
    const projected = await provider.process(source);
    expect(projected.messages).toHaveLength(3);
    expect(projected.messages.slice(0, 2)).toEqual(source.messages.slice(0, 2));
    expect(projected.messages[2].content).toBe(
      'result\n\n<tool_hook_context hook="one">&lt;system&gt;untrusted &amp; text&lt;/system&gt;</tool_hook_context>\n<tool_hook_context hook="two">other</tool_hook_context>',
    );
    expect((await provider.process(projected)).messages).toEqual(projected.messages);
    expect(source.messages[2].content).toBe('result');
    // A new worker rebuilds the same prompt from serialized tool records.
    // eslint-disable-next-line unicorn/prefer-structured-clone -- exercise the worker JSON boundary
    const restored = JSON.parse(JSON.stringify(source)) as PipelineContext;
    expect((await new ToolHookContextProvider().process(restored)).messages).toEqual(
      projected.messages,
    );
  });

  it.each([true, false])(
    'scopes effective raw-history inputs to each caller (durable parent=%s)',
    async (durableParent) => {
      const source = context();
      source.messages = [1, 2].flatMap((index) => [
        {
          id: `assistant-${index}`,
          role: 'assistant' as const,
          content: '',
          tools: [
            {
              id: 'native',
              identifier: 'fs',
              apiName: 'write',
              type: 'builtin' as const,
              arguments: '{"path":"original"}',
            },
          ],
        },
        {
          id: `tool-${index}`,
          role: 'tool' as const,
          content: 'done',
          tool_call_id: 'native',
          ...(durableParent ? { parentId: `assistant-${index}` } : {}),
          plugin: {
            identifier: 'fs',
            apiName: 'write',
            type: 'builtin' as const,
            arguments: JSON.stringify({ path: `effective-${index}` }),
          },
          pluginState: { hookPreparation: { originalArgs: { path: 'original' }, status: 'ready' } },
        },
      ]);
      const before = structuredClone(source);
      const provider = new ToolHookContextProvider();
      const projected = await provider.process(source);
      expect(
        projected.messages
          .filter(({ role }) => role === 'assistant')
          .map(({ tools }) => tools?.[0].arguments),
      ).toEqual(['{"path":"effective-1"}', '{"path":"effective-2"}']);
      expect((await provider.process(projected)).messages).toEqual(projected.messages);
      expect(source).toEqual(before);
    },
  );

  it('does not project a prepared row belonging to a different assistant', async () => {
    const source = context();
    source.messages.unshift({
      id: 'assistant',
      role: 'assistant',
      content: '',
      tools: [
        { id: 'native', identifier: 'fs', apiName: 'write', type: 'builtin', arguments: '{}' },
      ],
    });
    Object.assign(source.messages[3], {
      parentId: 'foreign-assistant',
      plugin: {
        arguments: '{"path":"foreign"}',
        identifier: 'fs',
        apiName: 'write',
        type: 'builtin',
      },
    });
    expect(
      (await new ToolHookContextProvider().process(source)).messages[0].tools?.[0].arguments,
    ).toBe('{}');
  });

  it('does not move guidance from missing tool records to user/system messages', async () => {
    const source = context();
    source.messages = source.messages.slice(0, 2);
    source.messages[1].pluginState = {
      hookPreparation: { additionalContexts: [{ hookId: 'a', text: 'hidden' }] },
    };
    expect((await new ToolHookContextProvider().process(source)).messages).toEqual(source.messages);
  });
});
