import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import {
  SYNTHETIC_TOOL_FAILURE_HINTS,
  syntheticToolFailureContent,
  ToolMessageReorder,
} from '../ToolMessageReorder';

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
              name: 'lobe-web-browsing____searchWithSearXNG',
            },
            id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
            type: 'function',
          },
          {
            function: {
              arguments:
                '{"query":"LobeChat","searchEngines":["brave","google","duckduckgo","qwant"]}',
              name: 'lobe-web-browsing____searchWithSearXNG',
            },
            id: 'tool_call_nXxXHW8Z',
            type: 'function',
          },
        ],
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG',
        role: 'tool',
        tool_call_id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
      },
      {
        content: 'LobeHub 是一个专注于设计和开发现代人工智能生成内容（AIGC）工具和组件的团队。',
        role: 'assistant',
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG',
        role: 'tool',
        tool_call_id: 'tool_call_nXxXHW8Z',
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG',
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
              name: 'lobe-web-browsing____searchWithSearXNG',
            },
            id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
            type: 'function',
          },
          {
            function: {
              arguments:
                '{"query":"LobeChat","searchEngines":["brave","google","duckduckgo","qwant"]}',
              name: 'lobe-web-browsing____searchWithSearXNG',
            },
            id: 'tool_call_nXxXHW8Z',
            type: 'function',
          },
        ],
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG',
        role: 'tool',
        tool_call_id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG',
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
        content: syntheticToolFailureContent('tool_result_missing', 'test-plugin____testApi'),
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

  // Regression: MessageContentProcessor turns a tool result that produced an
  // image into multimodal parts for vision models. The old string-only guard
  // here replaced those parts with the synthetic "Tool call failed" payload, so
  // a successful `readFile` on a screenshot reached the model as a failure and
  // the image was dropped from the request.
  it('should keep multimodal tool result parts produced for vision models', async () => {
    const proc = new ToolMessageReorder();
    const multimodalContent = [
      { text: '[Image: screenshot.png]', type: 'text' },
      {
        image_url: { detail: 'auto', url: 'https://app.lobehub.com/f/file_abc' },
        type: 'image_url',
      },
    ];
    const ctx = createContext([
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        tool_calls: [
          { function: { arguments: '{}', name: 'readFile' }, id: 'call_1', type: 'function' },
        ],
      },
      {
        id: 't1',
        role: 'tool',
        content: multimodalContent,
        tool_call_id: 'call_1',
      },
    ]);

    const result = await proc.process(ctx);

    expect(result.messages[1].content).toEqual(multimodalContent);
  });

  it('should fall back to the synthetic failure when tool content is empty or unusable', async () => {
    const proc = new ToolMessageReorder();
    const ctx = createContext([
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        tool_calls: [
          { function: { arguments: '{}', name: 'readFile' }, id: 'call_1', type: 'function' },
          { function: { arguments: '{}', name: 'readFile' }, id: 'call_2', type: 'function' },
        ],
      },
      { id: 't1', role: 'tool', content: [], tool_call_id: 'call_1' },
      { id: 't2', role: 'tool', content: undefined, tool_call_id: 'call_2' },
    ]);

    const result = await proc.process(ctx);

    const failure = JSON.stringify({
      error: 'Tool call failed',
      hint: SYNTHETIC_TOOL_FAILURE_HINTS.tool_result_unusable,
      reason: 'tool_result_unusable',
      success: false,
      synthetic: true,
      tool: 'readFile',
    });
    expect(result.messages[1].content).toBe(failure);
    expect(result.messages[2].content).toBe(failure);
  });

  it('should mark a missing tool result with the tool name and the missing reason', async () => {
    const proc = new ToolMessageReorder();
    const ctx = createContext([
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: { arguments: '{}', name: 'lobe-local-system____runCommand' },
            id: 'call_1',
            type: 'function',
          },
        ],
      },
      // No tool message at all — e.g. the result was lost to a gateway 503/504
      // while the tool may well have executed on the device.
    ]);

    const result = await proc.process(ctx);

    const failure = result.messages[1].content as string;
    expect(typeof failure).toBe('string');

    const parsed = JSON.parse(failure);
    expect(parsed).toEqual({
      error: 'Tool call failed',
      hint: SYNTHETIC_TOOL_FAILURE_HINTS.tool_result_missing,
      reason: 'tool_result_missing',
      success: false,
      synthetic: true,
      tool: 'lobe-local-system____runCommand',
    });
    // Structured fields must stay machine-readable, not flattened into prose.
    expect(parsed.reason).toBeDefined();
  });

  it('should give the two failure reasons distinct, actionable hints', async () => {
    const missing = JSON.parse(syntheticToolFailureContent('tool_result_missing', 'runCommand'));
    const unusable = JSON.parse(syntheticToolFailureContent('tool_result_unusable', 'runCommand'));

    // The missing-result hint must carry the retry-safety warning the old
    // payload lacked: a lost result says nothing about whether the call
    // executed, so the model is told to check observable state first.
    expect(missing.hint).toContain('executed is unknown');
    expect(missing.hint).toContain('check observable state');
    expect(missing.hint).toContain('side effects');

    // The unusable-result hint must not imply the call may not have run —
    // a result row exists, the call definitely executed and returned empty.
    expect(unusable.hint).not.toContain('executed is unknown');
    expect(unusable.hint).toContain('check the inputs');

    // The hints must be distinguishable, or the field adds noise.
    expect(missing.hint).not.toBe(unusable.hint);
  });
});
