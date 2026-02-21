import { describe, expect, it, vi } from 'vitest';

import type { PipelineContext } from '../../types';
import type { ToolCallConfig } from '../ToolCall';
import { ToolCallProcessor } from '../ToolCall';

describe('ToolCallProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: {
      messages: [],
      model: 'test-model',
      provider: 'test-provider',
    },
    isAborted: false,
    messages,
    metadata: {
      maxTokens: 4000,
      model: 'test-model',
    },
  });

  const defaultConfig: ToolCallConfig = {
    model: 'gpt-4',
    provider: 'openai',
  };

  describe('constructor', () => {
    it('should initialize with config', () => {
      const processor = new ToolCallProcessor(defaultConfig);
      expect(processor.name).toBe('ToolCallProcessor');
    });

    it('should initialize with custom options', () => {
      const processor = new ToolCallProcessor(defaultConfig, { debug: true });
      expect(processor.name).toBe('ToolCallProcessor');
    });
  });

  describe('process - assistant messages', () => {
    it('should convert tools to tool_calls format', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const context = createContext([
        {
          content: '',
          id: 'msg1',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{"query":"test"}',
              id: 'call_1',
              identifier: 'web',
              type: 'builtin',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('assistant');
      expect(result.messages[0].tool_calls).toEqual([
        {
          function: {
            arguments: '{"query":"test"}',
            name: 'web.search',
          },
          id: 'call_1',
          type: 'function',
        },
      ]);
    });

    it('should pass through thoughtSignature when present', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const context = createContext([
        {
          content: '',
          id: 'msg1',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{"query":"test"}',
              id: 'call_1',
              identifier: 'web',
              thoughtSignature: 'Let me search for this information',
              type: 'builtin',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].tool_calls).toEqual([
        {
          function: {
            arguments: '{"query":"test"}',
            name: 'web.search',
          },
          id: 'call_1',
          thoughtSignature: 'Let me search for this information',
          type: 'function',
        },
      ]);
    });

    it('should handle missing thoughtSignature', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const context = createContext([
        {
          content: '',
          id: 'msg1',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{"query":"test"}',
              id: 'call_1',
              identifier: 'web',
              type: 'builtin',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].tool_calls[0].thoughtSignature).toBeUndefined();
    });

    it('should use custom genToolCallingName function', async () => {
      const genToolCallingName = vi.fn(
        (identifier, apiName, type) => `custom_${identifier}_${apiName}_${type}`,
      );

      const processor = new ToolCallProcessor({
        ...defaultConfig,
        genToolCallingName,
      });

      const context = createContext([
        {
          content: '',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'call_1',
              identifier: 'web',
              type: 'builtin',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(genToolCallingName).toHaveBeenCalledWith('web', 'search', 'builtin');
      expect(result.messages[0].tool_calls[0].function.name).toBe('custom_web_search_builtin');
    });

    it('should handle multiple tool calls', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const context = createContext([
        {
          content: '',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{"query":"test1"}',
              id: 'call_1',
              identifier: 'web',
            },
            {
              apiName: 'translate',
              arguments: '{"text":"hello"}',
              id: 'call_2',
              identifier: 'utils',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].tool_calls).toHaveLength(2);
      expect(result.messages[0].tool_calls[0].function.name).toBe('web.search');
      expect(result.messages[0].tool_calls[1].function.name).toBe('utils.translate');
    });

    it('should remove tool_calls and tools when not supported', async () => {
      const isCanUseFC = vi.fn(() => false);

      const processor = new ToolCallProcessor({
        ...defaultConfig,
        isCanUseFC,
      });

      const context = createContext([
        {
          content: 'Using a tool',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'call_1',
              identifier: 'web',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(isCanUseFC).toHaveBeenCalledWith('gpt-4', 'openai');
      expect(result.messages[0]).not.toHaveProperty('tools');
      expect(result.messages[0]).not.toHaveProperty('tool_calls');
      expect(result.messages[0].content).toBe('Using a tool');
      expect(result.messages[0].role).toBe('assistant');
    });

    it('should remove empty tool_calls when not supported', async () => {
      const isCanUseFC = vi.fn(() => false);

      const processor = new ToolCallProcessor({
        ...defaultConfig,
        isCanUseFC,
      });

      const context = createContext([
        {
          content: 'Test',
          role: 'assistant',
          tool_calls: [],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0]).not.toHaveProperty('tool_calls');
      expect(result.messages[0]).not.toHaveProperty('tools');
    });

    it('should keep message when no tools present', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const context = createContext([
        {
          content: 'Regular message',
          role: 'assistant',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0]).toEqual({
        content: 'Regular message',
        role: 'assistant',
      });
    });
  });

  describe('process - tool messages', () => {
    it('should generate tool name from plugin', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const context = createContext([
        {
          content: 'Tool result',
          plugin: {
            apiName: 'search',
            identifier: 'web',
            type: 'builtin',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].name).toBe('web.search');
      expect(result.messages[0].tool_call_id).toBe('call_1');
      expect(result.messages[0].role).toBe('tool');
    });

    it('should use custom genToolCallingName for tool messages', async () => {
      const genToolCallingName = vi.fn(
        (identifier, apiName, type) => `tool_${identifier}_${apiName}_${type}`,
      );

      const processor = new ToolCallProcessor({
        ...defaultConfig,
        genToolCallingName,
      });

      const context = createContext([
        {
          content: 'Result',
          plugin: {
            apiName: 'search',
            identifier: 'web',
            type: 'plugin',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
      ]);

      const result = await processor.process(context);

      expect(genToolCallingName).toHaveBeenCalledWith('web', 'search', 'plugin');
      expect(result.messages[0].name).toBe('tool_web_search_plugin');
    });

    it('should convert tool message to user message when not supported', async () => {
      const isCanUseFC = vi.fn(() => false);

      const processor = new ToolCallProcessor({
        ...defaultConfig,
        isCanUseFC,
      });

      const context = createContext([
        {
          content: 'Tool result',
          name: 'web.search',
          plugin: {
            apiName: 'search',
            identifier: 'web',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Tool result');
      expect(result.messages[0].name).toBeUndefined();
      expect(result.messages[0].plugin).toBeUndefined();
      expect(result.messages[0].tool_call_id).toBeUndefined();
    });

    it('should handle tool message without plugin', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const context = createContext([
        {
          content: 'Result',
          role: 'tool',
          tool_call_id: 'call_1',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].name).toBeUndefined();
      expect(result.messages[0].role).toBe('tool');
      expect(result.messages[0].tool_call_id).toBe('call_1');
    });
  });

  describe('process - metadata', () => {
    it('should update metadata with processing stats', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const context = createContext([
        {
          content: '',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'call_1',
              identifier: 'web',
            },
          ],
        },
        {
          content: 'Result',
          plugin: {
            apiName: 'search',
            identifier: 'web',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
      ]);

      const result = await processor.process(context);

      expect(result.metadata.toolCallProcessed).toBe(2);
      expect(result.metadata.toolCallsConverted).toBe(1);
      expect(result.metadata.toolMessagesConverted).toBe(1);
      expect(result.metadata.supportTools).toBe(true);
    });

    it('should track supportTools when function calling not supported', async () => {
      const isCanUseFC = vi.fn(() => false);

      const processor = new ToolCallProcessor({
        ...defaultConfig,
        isCanUseFC,
      });

      const context = createContext([
        {
          content: 'Test',
          role: 'user',
        },
      ]);

      const result = await processor.process(context);

      expect(result.metadata.supportTools).toBe(false);
    });

    it('should count zero when no tool messages processed', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const context = createContext([
        {
          content: 'Regular message',
          role: 'user',
        },
      ]);

      const result = await processor.process(context);

      expect(result.metadata.toolCallProcessed).toBe(0);
      expect(result.metadata.toolCallsConverted).toBe(0);
      expect(result.metadata.toolMessagesConverted).toBe(0);
    });
  });

  describe('process - error handling', () => {
    it('should continue processing when message processing fails', async () => {
      const processor = new ToolCallProcessor(defaultConfig);

      // Create a message that might cause an error but should be handled gracefully
      const context = createContext([
        {
          content: 'Valid message',
          role: 'user',
        },
        {
          content: '',
          // Invalid tools structure
          role: 'assistant',
          tools: null,
        },
        {
          content: 'Another valid message',
          role: 'user',
        },
      ]);

      const result = await processor.process(context);

      // Should process all messages despite potential errors
      expect(result.messages).toHaveLength(3);
    });
  });

  describe('process - mixed scenarios', () => {
    it('should handle conversation with mixed message types', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const context = createContext([
        {
          content: 'System prompt',
          role: 'system',
        },
        {
          content: 'User question',
          role: 'user',
        },
        {
          content: '',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{"query":"test"}',
              id: 'call_1',
              identifier: 'web',
            },
          ],
        },
        {
          content: 'Search results',
          plugin: {
            apiName: 'search',
            identifier: 'web',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
        {
          content: 'Final response',
          role: 'assistant',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(5);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[2].role).toBe('assistant');
      expect(result.messages[2].tool_calls).toBeDefined();
      expect(result.messages[3].role).toBe('tool');
      expect(result.messages[3].name).toBe('web.search');
      expect(result.messages[4].role).toBe('assistant');
    });

    it('should not mutate original context', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const originalMessage = {
        content: '',
        id: 'msg1',
        role: 'assistant',
        tools: [
          {
            apiName: 'search',
            arguments: '{}',
            id: 'call_1',
            identifier: 'web',
          },
        ],
      };
      const context = createContext([originalMessage]);

      await processor.process(context);

      // Original message should be unchanged
      expect(originalMessage).toHaveProperty('tools');
      expect(originalMessage).not.toHaveProperty('tool_calls');
    });

    it('should return valid context after processing', async () => {
      const processor = new ToolCallProcessor(defaultConfig);
      const context = createContext([
        {
          content: 'Test',
          role: 'user',
        },
      ]);

      const result = await processor.process(context);

      expect(result).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.supportTools).toBeDefined();
    });
  });

  describe('isCanUseFC integration', () => {
    it('should call isCanUseFC with correct parameters', async () => {
      const isCanUseFC = vi.fn(() => true);

      const processor = new ToolCallProcessor({
        isCanUseFC,
        model: 'claude-3',
        provider: 'anthropic',
      });

      const context = createContext([
        {
          content: 'Test',
          role: 'user',
        },
      ]);

      await processor.process(context);

      expect(isCanUseFC).toHaveBeenCalledWith('claude-3', 'anthropic');
    });

    it('should default to supporting tools when isCanUseFC not provided', async () => {
      const processor = new ToolCallProcessor({
        model: 'test-model',
        provider: 'test-provider',
      });

      const context = createContext([
        {
          content: '',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'call_1',
              identifier: 'web',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.metadata.supportTools).toBe(true);
      expect(result.messages[0].tool_calls).toBeDefined();
    });
  });
});
