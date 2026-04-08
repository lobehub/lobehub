import { describe, expect, it, vi } from 'vitest';

// Now import the real service — only the stubs above are faked
import { ResponsesService } from '../responses.service';

// Stub external dependencies so ResponsesService can be imported in isolation
vi.mock('@/server/modules/AgentRuntime/InMemoryStreamEventManager', () => ({
  InMemoryStreamEventManager: class {},
}));
vi.mock('@/server/modules/AgentRuntime/StreamEventManager', () => ({}));
vi.mock('@/server/services/agentRuntime', () => ({ AgentRuntimeService: class {} }));
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: class {} }));
vi.mock('../../common/base.service', () => ({
  BaseService: class {
    db: any;
    userId = '';
    constructor() {}
    log() {}
  },
}));

// Helper: call the private extractOutputItems via bracket notation
const callExtractOutputItems = (messages: any[], responseId: string) => {
  const svc = new (ResponsesService as any)(null, null);
  return svc['extractOutputItems']({ messages }, responseId);
};

describe('ResponsesService.extractOutputItems', () => {
  describe('assistant message with tool_calls should still emit message item', () => {
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

      const { output } = callExtractOutputItems(messages, 'tpc_test');

      expect(output).toHaveLength(2);

      expect(output[0]).toMatchObject({
        content: [
          {
            text: '好的，我来在沙箱中随机生成一个散点图！',
            type: 'output_text',
          },
        ],
        role: 'assistant',
        status: 'completed',
        type: 'message',
      });

      expect(output[1]).toMatchObject({
        status: 'completed',
        type: 'function_call',
      });
    });

    it('should still work for assistant messages without tool_calls', () => {
      const messages = [{ content: 'Hello, how can I help?', role: 'assistant' }];

      const { output, outputText } = callExtractOutputItems(messages, 'tpc_test');

      expect(output).toHaveLength(1);
      expect(output[0].type).toBe('message');
      expect(outputText).toBe('Hello, how can I help?');
    });

    it('should not emit message for assistant with empty content + tool_calls', () => {
      const messages = [
        {
          content: '',
          role: 'assistant',
          tool_calls: [{ function: { arguments: '{}', name: 'my-plugin____myApi' }, id: 'call_1' }],
        },
      ];

      const { output } = callExtractOutputItems(messages, 'tpc_test');

      expect(output).toHaveLength(1);
      expect(output[0].type).toBe('function_call');
    });
  });

  describe('function_call name should be decoded from internal ____-separated format', () => {
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

      const { output } = callExtractOutputItems(messages, 'tpc_test');

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

      const { output } = callExtractOutputItems(messages, 'tpc_test');

      const fc = output.find((item: any) => item.type === 'function_call');
      expect(fc.name).toBe('get_weather');
    });

    it('should decode default type tools: identifier____apiName → identifier/apiName', () => {
      const messages = [
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            { function: { arguments: '{}', name: 'my-plugin____myApi' }, id: 'call_def' },
          ],
        },
      ];

      const { output } = callExtractOutputItems(messages, 'tpc_test');

      const fc = output.find((item: any) => item.type === 'function_call');
      expect(fc.name).toBe('my-plugin/myApi');
    });

    it('should return raw name when no separator is present', () => {
      const messages = [
        {
          content: '',
          role: 'assistant',
          tool_calls: [{ function: { arguments: '{}', name: 'simple_tool' }, id: 'call_simple' }],
        },
      ];

      const { output } = callExtractOutputItems(messages, 'tpc_test');

      const fc = output.find((item: any) => item.type === 'function_call');
      expect(fc.name).toBe('simple_tool');
    });
  });

  describe('function_call id should match streaming output_index', () => {
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

      const { output } = callExtractOutputItems(messages, 'tpc_test');

      expect(output[0].id).toBe('msg_tpc_test_0');
      expect(output[1].id).toBe('fc_tpc_test_1');
    });

    it('should assign index 0 to function_call when no message content', () => {
      const messages = [
        {
          content: '',
          role: 'assistant',
          tool_calls: [{ function: { arguments: '{}', name: 'plugin____api' }, id: 'call_1' }],
        },
      ];

      const { output } = callExtractOutputItems(messages, 'tpc_test');
      expect(output[0].id).toBe('fc_tpc_test_0');
    });
  });
});
