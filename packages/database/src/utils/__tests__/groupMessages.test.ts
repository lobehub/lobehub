import { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { groupAssistantMessages } from '../groupMessages';

describe('groupAssistantMessages', () => {
  describe('Basic Scenarios', () => {
    it('should group single assistant with single tool result', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Checking weather',
          tools: [
            {
              id: 'tool-1',
              identifier: 'weather',
              apiName: 'getWeather',
              arguments: '{"city":"Beijing"}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          content: 'Beijing: Sunny, 25°C',
          pluginState: { cached: true },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('group');
      expect(result[0].content).toBe('');
      expect(result[0].children).toHaveLength(1);

      const block = result[0].children![0];
      expect(block.content).toBe('Checking weather');
      expect(block.tools).toHaveLength(1);
      expect(block.tools![0]).toMatchObject({
        id: 'tool-1',
        identifier: 'weather',
        apiName: 'getWeather',
        result: {
          content: 'Beijing: Sunny, 25°C',
          state: { cached: true },
        },
      });
    });

    it('should group assistant message with multiple tool results', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Checking weather and news',
          tools: [
            {
              id: 'tool-1',
              identifier: 'weather',
              apiName: 'getWeather',
              arguments: '{"city":"Beijing"}',
              type: 'default',
            },
            {
              id: 'tool-2',
              identifier: 'news',
              apiName: 'getNews',
              arguments: '{"category":"tech"}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          content: 'Beijing: Sunny, 25°C',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-3',
          role: 'tool',
          tool_call_id: 'tool-2',
          content: 'Latest tech news: AI breakthrough',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('group');
      expect(result[0].children).toHaveLength(1);

      const block = result[0].children![0];
      expect(block.tools).toHaveLength(2);
      expect(block.tools![0].result?.content).toBe('Beijing: Sunny, 25°C');
      expect(block.tools![1].result?.content).toBe('Latest tech news: AI breakthrough');
    });

    it('should handle assistant message without tools', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Hello!',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('Hello!');
      expect(result[0].children).toBeUndefined();
    });

    it('should handle tool result not yet available', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Checking weather',
          tools: [
            {
              id: 'tool-1',
              identifier: 'weather',
              apiName: 'getWeather',
              arguments: '{"city":"Beijing"}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('group');
      expect(result[0].children).toHaveLength(1);

      const block = result[0].children![0];
      expect(block.tools).toHaveLength(1);
      expect(block.tools![0].result).toBeUndefined();
    });
  });

  describe('Multi-turn Conversation', () => {
    it('should group messages in multi-turn conversation', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'What is the weather?',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Checking weather',
          tools: [
            {
              id: 'tool-1',
              identifier: 'weather',
              apiName: 'getWeather',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-3',
          role: 'tool',
          tool_call_id: 'tool-1',
          content: 'Sunny, 25°C',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-4',
          role: 'user',
          content: 'What about news?',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-5',
          role: 'assistant',
          content: 'Checking news',
          tools: [
            {
              id: 'tool-2',
              identifier: 'news',
              apiName: 'getNews',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-6',
          role: 'tool',
          tool_call_id: 'tool-2',
          content: 'AI breakthrough',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result).toHaveLength(4); // 2 users + 2 grouped assistants
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('group');
      expect(result[2].role).toBe('user');
      expect(result[3].role).toBe('group');
    });

    it('should handle mixed grouped and non-grouped messages', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Hello!',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Using tools',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test',
              apiName: 'test',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-3',
          role: 'tool',
          tool_call_id: 'tool-1',
          content: 'Result',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('assistant');
      expect(result[0].children).toBeUndefined();
      expect(result[1].role).toBe('group');
      expect(result[1].children).toHaveLength(1);
    });
  });

  describe('Edge Cases', () => {
    it('should group follow-up assistant with its own tools and results', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Let me check the weather',
          tools: [
            {
              id: 'tool-1',
              identifier: 'weather',
              apiName: 'getWeather',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          content: 'Sunny, 25°C',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-3',
          role: 'assistant',
          content: 'Based on weather, let me check news',
          parentId: 'msg-2',
          tools: [
            {
              id: 'tool-2',
              identifier: 'news',
              apiName: 'getNews',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-4',
          role: 'tool',
          tool_call_id: 'tool-2',
          content: 'Breaking news',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      // Should have 1 group with 2 children
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('group');
      expect(result[0].children).toHaveLength(2);

      // First child: original assistant with tool result
      expect(result[0].children![0].id).toBe('msg-1');
      expect(result[0].children![0].tools![0].result?.content).toBe('Sunny, 25°C');

      // Second child: follow-up assistant with its own tool result
      expect(result[0].children![1].id).toBe('msg-3');
      expect(result[0].children![1].tools).toHaveLength(1);
      expect(result[0].children![1].tools![0].result?.content).toBe('Breaking news');
    });

    it('should group multiple follow-up assistants in chain (3+ assistants)', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Step 1',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test1',
              apiName: 'test1',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          content: 'Result 1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-3',
          role: 'assistant',
          content: 'Step 2',
          parentId: 'msg-2',
          tools: [
            {
              id: 'tool-2',
              identifier: 'test2',
              apiName: 'test2',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-4',
          role: 'tool',
          tool_call_id: 'tool-2',
          content: 'Result 2',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-5',
          role: 'assistant',
          content: 'Step 3 final',
          parentId: 'msg-4',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      // Should have 1 group with 3 children
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('group');
      expect(result[0].children).toHaveLength(3);

      expect(result[0].children![0].id).toBe('msg-1');
      expect(result[0].children![0].tools![0].result?.content).toBe('Result 1');

      expect(result[0].children![1].id).toBe('msg-3');
      expect(result[0].children![1].tools![0].result?.content).toBe('Result 2');

      expect(result[0].children![2].id).toBe('msg-5');
      expect(result[0].children![2].content).toBe('Step 3 final');
    });

    it('should group follow-up assistant with parentId pointing to tool', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Let me check',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test',
              apiName: 'test',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          content: 'Tool result',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-3',
          role: 'assistant',
          content: 'Based on the result, here is my answer',
          parentId: 'msg-2', // Points to tool message
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      // Should have 1 group containing both assistants
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('group');
      expect(result[0].children).toHaveLength(2);

      // First child: original assistant with tool result
      expect(result[0].children![0].id).toBe('msg-1');
      expect(result[0].children![0].content).toBe('Let me check');
      expect(result[0].children![0].tools![0].result?.content).toBe('Tool result');

      // Second child: follow-up assistant
      expect(result[0].children![1].id).toBe('msg-3');
      expect(result[0].children![1].content).toBe('Based on the result, here is my answer');
    });

    it('should handle orphaned tool messages', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'tool',
          tool_call_id: 'unknown-tool',
          content: 'Orphaned result',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('tool');
    });

    it('should handle tool messages with errors', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Checking',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test',
              apiName: 'test',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          content: '',
          pluginError: { message: 'Failed to execute' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('group');

      const block = result[0].children![0];
      expect(block.tools![0].result?.error).toEqual({ message: 'Failed to execute' });
    });

    it('should preserve message order', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'First',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Second',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-3',
          role: 'user',
          content: 'Third',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result).toHaveLength(3);
      expect(result[0].content).toBe('First');
      expect(result[1].content).toBe('Second');
      expect(result[2].content).toBe('Third');
    });
  });

  describe('Children Structure Validation', () => {
    it('should use message ID as block ID', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Test',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test',
              apiName: 'test',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result[0].children![0].id).toBe('msg-1');
    });

    it('should clear parent fields when creating children', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Test',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test',
              apiName: 'test',
              arguments: '{}',
              type: 'default',
            },
          ],
          imageList: [{ id: 'img-1', url: 'http://example.com/img.png', alt: 'test' }],
          fileList: [
            {
              id: 'file-1',
              url: 'http://example.com/file.pdf',
              name: 'test.pdf',
              size: 1024,
              fileType: 'application/pdf',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result[0].tools).toBeUndefined();
      expect(result[0].imageList).toBeUndefined();
      expect(result[0].fileList).toBeUndefined();
      expect(result[0].content).toBe('');

      const block = result[0].children![0];
      expect(block.content).toBe('Test');
      expect(block.tools).toHaveLength(1);
      expect(block.imageList).toHaveLength(1);
      expect(block.fileList).toHaveLength(1);
    });

    it('should preserve all tool result fields', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Test',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test',
              apiName: 'test',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          content: 'Result content',
          pluginState: { step: 1 },
          pluginError: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      const block = result[0].children![0];
      expect(block.tools![0].result).toMatchObject({
        content: 'Result content',
        state: { step: 1 },
        error: null,
      });
    });
  });

  describe('Metadata Handling', () => {
    it('should preserve usage and performance in children blocks', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Test',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test',
              apiName: 'test',
              arguments: '{}',
              type: 'default',
            },
          ],
          metadata: {
            totalInputTokens: 100,
            totalOutputTokens: 50,
            totalTokens: 150,
            cost: 0.01,
            tps: 50,
            ttft: 100,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      // Child should have usage
      expect(result[0].children![0].usage).toEqual({
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
        cost: 0.01,
      });

      // Child should have performance
      expect(result[0].children![0].performance).toEqual({
        tps: 50,
        ttft: 100,
      });
    });

    it('should aggregate usage and performance from multiple children', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Step 1',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test1',
              apiName: 'test1',
              arguments: '{}',
              type: 'default',
            },
          ],
          metadata: {
            totalInputTokens: 100,
            totalOutputTokens: 50,
            totalTokens: 150,
            cost: 0.01,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          content: 'Result 1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-3',
          role: 'assistant',
          content: 'Step 2',
          parentId: 'msg-2',
          metadata: {
            totalInputTokens: 200,
            totalOutputTokens: 100,
            totalTokens: 300,
            cost: 0.02,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      // Group should have aggregated usage
      expect(result[0].usage).toEqual({
        totalInputTokens: 300, // 100 + 200
        totalOutputTokens: 150, // 50 + 100
        totalTokens: 450, // 150 + 300
        cost: 0.03, // 0.01 + 0.02
      });

      // metadata should be cleared in favor of usage/performance
      expect(result[0].metadata).toBeUndefined();
    });

    it('should handle speed metrics correctly', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Step 1',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test1',
              apiName: 'test1',
              arguments: '{}',
              type: 'default',
            },
          ],
          metadata: {
            ttft: 100,
            tps: 50,
            duration: 1000,
            latency: 1200,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          content: 'Result 1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
        {
          id: 'msg-3',
          role: 'assistant',
          content: 'Step 2',
          parentId: 'msg-2',
          metadata: {
            ttft: 200, // Should be ignored
            tps: 60,
            duration: 1500,
            latency: 1800,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      // Verify performance metrics aggregation
      expect(result[0].performance).toEqual({
        ttft: 100, // First child's value only
        tps: 55, // Average: (50 + 60) / 2
        duration: 2500, // Sum: 1000 + 1500
        latency: 3000, // Sum: 1200 + 1800
      });

      // metadata should be cleared in favor of usage/performance
      expect(result[0].metadata).toBeUndefined();
    });

    it('should have no usage or performance if children have no metadata', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Test',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test',
              apiName: 'test',
              arguments: '{}',
              type: 'default',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      // Should have no usage or performance
      expect(result[0].usage).toBeUndefined();
      expect(result[0].performance).toBeUndefined();
      expect(result[0].metadata).toBeUndefined();
    });
  });

  describe('Empty and Null Cases', () => {
    it('should convert empty arrays to undefined in children', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Test',
          tools: [
            {
              id: 'tool-1',
              identifier: 'test',
              apiName: 'test',
              arguments: '{}',
              type: 'default',
            },
          ],
          imageList: [], // Empty array
          fileList: [], // Empty array
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      // Empty arrays should become undefined
      expect(result[0].children![0].imageList).toBeUndefined();
      expect(result[0].children![0].fileList).toBeUndefined();
    });

    it('should handle empty message list', () => {
      const result = groupAssistantMessages([]);
      expect(result).toEqual([]);
    });

    it('should handle empty tools array', () => {
      const input: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Test',
          tools: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        } as UIChatMessage,
      ];

      const result = groupAssistantMessages(input);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].children).toBeUndefined();
    });
  });
});
