import { describe, expect, it } from 'vitest';

/**
 * Regression tests for extractOutputItems logic in ResponsesService.
 *
 * These tests reproduce three bugs in the response.completed output:
 * 1. Assistant message with tool_calls is dropped from output (only function_call is kept)
 * 2. Function call names use internal ____-separated format instead of identifier/apiName
 * 3. Function call IDs are inconsistent with streaming (itemCounter doesn't account for message)
 */

const SEPARATOR = '____';

function decodeToolName(rawName: string): string {
  if (rawName.startsWith(`lobe-client-fn${SEPARATOR}`)) {
    return rawName.slice(`lobe-client-fn${SEPARATOR}`.length);
  }
  const parts = rawName.split(SEPARATOR);
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return rawName;
}

/**
 * Mirrors the fixed extractOutputItems logic from ResponsesService.
 */
function extractOutputItems(
  messages: any[],
  responseId: string,
): { output: any[]; outputText: string } {
  if (!messages?.length) return { output: [], outputText: '' };

  const output: any[] = [];
  let outputText = '';
  let itemCounter = 0;

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;

      // Emit message item for assistant text content (even when tool_calls are present)
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content) {
        outputText = content;
        output.push({
          content: [{ annotations: [], logprobs: [], text: content, type: 'output_text' as const }],
          id: `msg_${responseId}_${itemCounter++}`,
          role: 'assistant' as const,
          status: 'completed' as const,
          type: 'message' as const,
        });
      }

      // Handle tool_calls from assistant
      if (hasToolCalls) {
        for (const toolCall of msg.tool_calls) {
          const fnName = decodeToolName(toolCall.function?.name ?? '');
          output.push({
            arguments: toolCall.function?.arguments ?? '{}',
            call_id: toolCall.id ?? `call_${itemCounter}`,
            id: `fc_${responseId}_${itemCounter++}`,
            name: fnName,
            status: 'completed' as const,
            type: 'function_call' as const,
          });
        }
      }
    } else if (msg.role === 'tool') {
      output.push({
        call_id: msg.tool_call_id ?? '',
        id: `fco_${responseId}_${itemCounter++}`,
        output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        status: 'completed' as const,
        type: 'function_call_output' as const,
      });
    }
  }

  return { output, outputText };
}

describe('ResponsesService.extractOutputItems - regression', () => {
  describe('Bug 1: assistant message with tool_calls should still emit message item', () => {
    it('should include both message and function_call when assistant has text + tool_calls', () => {
      const messages = [
        {
          content: '好的，我来在沙箱中随机生成一个散点图！',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: '{"code":"import matplotlib.pyplot as plt\\nprint(1)"}',
                name: 'lobe-cloud-sandbox____executeCode____builtin',
              },
              id: 'call_abc123',
            },
          ],
        },
      ];

      const { output } = extractOutputItems(messages, 'tpc_test');

      // Should have 2 output items: message + function_call
      expect(output).toHaveLength(2);

      expect(output[0]).toMatchObject({
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: '好的，我来在沙箱中随机生成一个散点图！',
          },
        ],
      });

      expect(output[1]).toMatchObject({
        type: 'function_call',
        status: 'completed',
      });
    });

    it('should still work for assistant messages without tool_calls', () => {
      const messages = [
        {
          content: 'Hello, how can I help?',
          role: 'assistant',
        },
      ];

      const { output, outputText } = extractOutputItems(messages, 'tpc_test');

      expect(output).toHaveLength(1);
      expect(output[0].type).toBe('message');
      expect(outputText).toBe('Hello, how can I help?');
    });

    it('should not emit message for assistant with empty content + tool_calls', () => {
      const messages = [
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{}', name: 'my-plugin____myApi' },
              id: 'call_1',
            },
          ],
        },
      ];

      const { output } = extractOutputItems(messages, 'tpc_test');

      // Only function_call, no message (empty content)
      expect(output).toHaveLength(1);
      expect(output[0].type).toBe('function_call');
    });
  });

  describe('Bug 2: function_call name should be decoded from internal ____-separated format', () => {
    it('should decode builtin tool names: identifier____apiName____builtin → identifier/apiName', () => {
      const messages = [
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: '{"code":"print(1)"}',
                name: 'lobe-cloud-sandbox____executeCode____builtin',
              },
              id: 'call_abc123',
            },
          ],
        },
      ];

      const { output } = extractOutputItems(messages, 'tpc_test');

      const fc = output.find((item: any) => item.type === 'function_call');
      expect(fc.name).toBe('lobe-cloud-sandbox/executeCode');
    });

    it('should strip lobe-client-fn prefix correctly', () => {
      const messages = [
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{}', name: 'lobe-client-fn____get_weather' },
              id: 'call_xyz',
            },
          ],
        },
      ];

      const { output } = extractOutputItems(messages, 'tpc_test');
      const fc = output.find((item: any) => item.type === 'function_call');
      expect(fc.name).toBe('get_weather');
    });

    it('should decode default type tools: identifier____apiName → identifier/apiName', () => {
      const messages = [
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{}', name: 'my-plugin____myApi' },
              id: 'call_def',
            },
          ],
        },
      ];

      const { output } = extractOutputItems(messages, 'tpc_test');
      const fc = output.find((item: any) => item.type === 'function_call');
      expect(fc.name).toBe('my-plugin/myApi');
    });

    it('should return raw name when no separator is present', () => {
      const messages = [
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{}', name: 'simple_tool' },
              id: 'call_simple',
            },
          ],
        },
      ];

      const { output } = extractOutputItems(messages, 'tpc_test');
      const fc = output.find((item: any) => item.type === 'function_call');
      expect(fc.name).toBe('simple_tool');
    });
  });

  describe('Bug 3: function_call id should match streaming output_index', () => {
    it('should assign index 1 to function_call when message (index 0) precedes it', () => {
      const messages = [
        {
          content: '好的，我来执行代码！',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: '{"code":"1+1"}',
                name: 'lobe-cloud-sandbox____executeCode____builtin',
              },
              id: 'call_abc',
            },
          ],
        },
      ];

      const { output } = extractOutputItems(messages, 'tpc_test');

      // message should be index 0, function_call should be index 1
      expect(output[0].id).toBe('msg_tpc_test_0');
      expect(output[1].id).toBe('fc_tpc_test_1');
    });

    it('should assign index 0 to function_call when no message content', () => {
      const messages = [
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{}', name: 'plugin____api' },
              id: 'call_1',
            },
          ],
        },
      ];

      const { output } = extractOutputItems(messages, 'tpc_test');
      expect(output[0].id).toBe('fc_tpc_test_0');
    });
  });
});
