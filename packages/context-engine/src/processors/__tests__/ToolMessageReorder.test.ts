import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { ToolMessageReorder } from '../ToolMessageReorder';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] } as any,
  messages,
  metadata: { model: 'gpt-4', maxTokens: 4096 },
  isAborted: false,
});

describe('ToolMessageReorder', () => {
  it('should place tool messages right after their assistant calls and drop invalid tools', async () => {
    const proc = new ToolMessageReorder();
    const messages = [
      { id: 'u1', role: 'user', content: 'hi' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' } },
        ],
      },
      { id: 't1', role: 'tool', content: '{"ok":1}', tool_call_id: 'call_1' },
      { id: 't_invalid', role: 'tool', content: '{"ok":0}' },
    ];

    const ctx = createContext(messages);
    const res = await proc.process(ctx);

    expect(res.messages.map((m) => m.id)).toEqual(['u1', 'a1', 't1']);
  });

  it('should reorderToolMessages', async () => {
    const proc = new ToolMessageReorder();
    const messages = [
      {
        content: '## Tools\n\nYou can use these tools',
        role: 'system',
      },
      {
        content: '',
        role: 'assistant',
        tool_calls: [
          {
            function: {
              arguments:
                '{"query":"LobeChat","searchEngines":["brave","google","duckduckgo","qwant"]}',
              name: 'lobe-web-browsing____searchWithSearXNG____builtin',
            },
            id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
            type: 'function',
          },
          {
            function: {
              arguments:
                '{"query":"LobeChat","searchEngines":["brave","google","duckduckgo","qwant"]}',
              name: 'lobe-web-browsing____searchWithSearXNG____builtin',
            },
            id: 'tool_call_nXxXHW8Z',
            type: 'function',
          },
        ],
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG____builtin',
        role: 'tool',
        tool_call_id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
      },
      {
        content: 'LobeHub 是一个专注于设计和开发现代人工智能生成内容（AIGC）工具和组件的团队。',
        role: 'assistant',
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG____builtin',
        role: 'tool',
        tool_call_id: 'tool_call_nXxXHW8Z',
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG____builtin',
        role: 'tool',
        tool_call_id: 'tool_call_2f3CEKz9',
      },
      {
        content: '### LobeHub 智能AI聚合神器\n\nLobeHub 是一个强大的AI聚合平台',
        role: 'assistant',
      },
    ];

    const ctx = createContext(messages);

    const output = await proc.process(ctx);

    expect(output.messages).toEqual([
      {
        content: '## Tools\n\nYou can use these tools',
        role: 'system',
      },
      {
        content: '',
        role: 'assistant',
        tool_calls: [
          {
            function: {
              arguments:
                '{"query":"LobeChat","searchEngines":["brave","google","duckduckgo","qwant"]}',
              name: 'lobe-web-browsing____searchWithSearXNG____builtin',
            },
            id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
            type: 'function',
          },
          {
            function: {
              arguments:
                '{"query":"LobeChat","searchEngines":["brave","google","duckduckgo","qwant"]}',
              name: 'lobe-web-browsing____searchWithSearXNG____builtin',
            },
            id: 'tool_call_nXxXHW8Z',
            type: 'function',
          },
        ],
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG____builtin',
        role: 'tool',
        tool_call_id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG____builtin',
        role: 'tool',
        tool_call_id: 'tool_call_nXxXHW8Z',
      },
      {
        content: 'LobeHub 是一个专注于设计和开发现代人工智能生成内容（AIGC）工具和组件的团队。',
        role: 'assistant',
      },
      {
        content: '### LobeHub 智能AI聚合神器\n\nLobeHub 是一个强大的AI聚合平台',
        role: 'assistant',
      },
    ]);
  });

  it('should correctly reorder when a tool message appears before the assistant message', async () => {
    const messages = [
      {
        role: 'system',
        content: 'System message',
      },
      {
        role: 'tool',
        tool_call_id: 'tool_call_1',
        name: 'test-plugin____testApi',
        content: '',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'tool_call_1', type: 'function', function: { name: 'testApi', arguments: '{}' } },
        ],
      },
    ];

    const proc = new ToolMessageReorder();

    const ctx = createContext(messages);

    const { messages: output } = await proc.process(ctx);

    expect(output.length).toBe(3);
    expect(output[0].role).toBe('system');
    expect(output[1].role).toBe('assistant');
    expect(output[2]).toEqual(
      expect.objectContaining({
        role: 'tool',
        content: '',
        tool_call_id: 'tool_call_1',
      }),
    );
  });

  it('should generate a synthetic tool result when a tool message is missing', async () => {
    const proc = new ToolMessageReorder();
    const ctx = createContext([
      { id: 'u1', role: 'user', content: 'hi' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          {
            function: { arguments: '{}', name: 'test-plugin____testApi' },
            id: 'call_missing',
            type: 'function',
          },
        ],
      },
    ]);

    const result = await proc.process(ctx);

    expect(result.messages).toEqual([
      { id: 'u1', role: 'user', content: 'hi' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          {
            function: { arguments: '{}', name: 'test-plugin____testApi' },
            id: 'call_missing',
            type: 'function',
          },
        ],
      },
      {
        content: '{"error":"Tool call failed","success":false,"synthetic":true}',
        name: 'test-plugin____testApi',
        role: 'tool',
        tool_call_id: 'call_missing',
      },
    ]);
  });

  it('should dedupe duplicate tool calls and keep the first real tool result', async () => {
    const proc = new ToolMessageReorder();
    const ctx = createContext([
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          { function: { arguments: '{}', name: 'test' }, id: 'call_1', type: 'function' },
          { function: { arguments: '{}', name: 'test' }, id: 'call_1', type: 'function' },
          { function: { arguments: '{}', name: 'test2' }, id: 'call_2', type: 'function' },
        ],
      },
      { id: 't2', role: 'tool', content: '{"ok":2}', tool_call_id: 'call_2' },
      { id: 't1-first', role: 'tool', content: '{"ok":1}', tool_call_id: 'call_1' },
      { id: 't1-second', role: 'tool', content: '{"ok":3}', tool_call_id: 'call_1' },
      { id: 'orphan', role: 'tool', content: '{"ok":4}', tool_call_id: 'call_3' },
    ]);

    const result = await proc.process(ctx);

    expect(result.messages).toEqual([
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          { function: { arguments: '{}', name: 'test' }, id: 'call_1', type: 'function' },
          { function: { arguments: '{}', name: 'test2' }, id: 'call_2', type: 'function' },
        ],
      },
      { id: 't1-first', role: 'tool', content: '{"ok":1}', tool_call_id: 'call_1' },
      { id: 't2', role: 'tool', content: '{"ok":2}', tool_call_id: 'call_2' },
    ]);
  });

  it('should prefer a real error tool result over a synthetic fallback', async () => {
    const proc = new ToolMessageReorder();
    const ctx = createContext([
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          { function: { arguments: '{}', name: 'test' }, id: 'call_1', type: 'function' },
        ],
      },
      {
        id: 't1',
        role: 'tool',
        content: '',
        pluginError: { message: 'Manifest not found for tool: test' },
        tool_call_id: 'call_1',
      },
    ]);

    const result = await proc.process(ctx);

    expect(result.messages).toEqual([
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          { function: { arguments: '{}', name: 'test' }, id: 'call_1', type: 'function' },
        ],
      },
      {
        id: 't1',
        role: 'tool',
        content: 'Manifest not found for tool: test',
        pluginError: { message: 'Manifest not found for tool: test' },
        tool_call_id: 'call_1',
      },
    ]);
  });
});
