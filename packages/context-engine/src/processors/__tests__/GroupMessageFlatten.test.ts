import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { GroupMessageFlattenProcessor } from '../GroupMessageFlatten';

describe('GroupMessageFlattenProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  describe('Basic Scenarios', () => {
    it('should flatten group message with single child and single tool result', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-group-1',
          role: 'assistantGroup',
          content: '',
          createdAt: '2025-10-27T10:00:00.000Z',
          updatedAt: '2025-10-27T10:00:10.000Z',
          meta: { title: 'Test Agent' },
          children: [
            {
              id: 'msg-1',
              content: 'Checking weather',
              tools: [
                {
                  id: 'tool-1',
                  type: 'builtin',
                  apiName: 'search',
                  arguments: '{"query":"weather"}',
                  identifier: 'web-browsing',
                  result: {
                    id: 'msg-tool-1',
                    content: 'Weather is sunny, 25°C',
                    error: null,
                    state: { cached: true },
                  },
                },
              ],
              usage: { totalTokens: 100 },
              performance: { tps: 20 },
            },
          ],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should create 2 messages: 1 assistant + 1 tool
      expect(result.messages).toHaveLength(2);

      // Check assistant message
      const assistantMsg = result.messages[0];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.id).toBe('msg-1');
      expect(assistantMsg.content).toBe('Checking weather');
      expect(assistantMsg.tools).toHaveLength(1);
      expect(assistantMsg.tools[0]).toEqual({
        id: 'tool-1',
        type: 'builtin',
        apiName: 'search',
        arguments: '{"query":"weather"}',
        identifier: 'web-browsing',
      });
      expect(assistantMsg.createdAt).toBe('2025-10-27T10:00:00.000Z');
      expect(assistantMsg.meta).toEqual({ title: 'Test Agent' });

      // Check tool message
      const toolMsg = result.messages[1];
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.id).toBe('msg-tool-1');
      expect(toolMsg.content).toBe('Weather is sunny, 25°C');
      expect(toolMsg.tool_call_id).toBe('tool-1');
      expect(toolMsg.plugin).toEqual({
        id: 'tool-1',
        type: 'builtin',
        apiName: 'search',
        arguments: '{"query":"weather"}',
        identifier: 'web-browsing',
      });
      expect(toolMsg.pluginState).toEqual({ cached: true });

      // Check metadata
      expect(result.metadata.groupMessagesFlattened).toBe(1);
      expect(result.metadata.assistantMessagesCreated).toBe(1);
      expect(result.metadata.toolMessagesCreated).toBe(1);
    });

    it('should flatten group message with multiple children', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-group-1',
          role: 'assistantGroup',
          content: '',
          children: [
            {
              id: 'msg-1',
              content: 'First response',
              tools: [
                {
                  id: 'tool-1',
                  type: 'builtin',
                  apiName: 'search',
                  arguments: '{}',
                  identifier: 'web-browsing',
                  result: {
                    id: 'msg-tool-1',
                    content: 'Result 1',
                    error: null,
                    state: {},
                  },
                },
              ],
            },
            {
              id: 'msg-2',
              content: 'Follow-up response',
              tools: [
                {
                  id: 'tool-2',
                  type: 'builtin',
                  apiName: 'search',
                  arguments: '{}',
                  identifier: 'web-browsing',
                  result: {
                    id: 'msg-tool-2',
                    content: 'Result 2',
                    error: null,
                    state: {},
                  },
                },
              ],
            },
          ],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should create 4 messages: 2 assistants + 2 tools
      expect(result.messages).toHaveLength(4);
      expect(result.messages[0].role).toBe('assistant');
      expect(result.messages[0].id).toBe('msg-1');
      expect(result.messages[1].role).toBe('tool');
      expect(result.messages[1].id).toBe('msg-tool-1');
      expect(result.messages[2].role).toBe('assistant');
      expect(result.messages[2].id).toBe('msg-2');
      expect(result.messages[3].role).toBe('tool');
      expect(result.messages[3].id).toBe('msg-tool-2');

      expect(result.metadata.groupMessagesFlattened).toBe(1);
      expect(result.metadata.assistantMessagesCreated).toBe(2);
      expect(result.metadata.toolMessagesCreated).toBe(2);
    });

    it('should handle child without tool result (still executing)', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-group-1',
          role: 'assistantGroup',
          content: '',
          children: [
            {
              id: 'msg-1',
              content: 'Checking weather',
              tools: [
                {
                  id: 'tool-1',
                  type: 'builtin',
                  apiName: 'search',
                  arguments: '{}',
                  identifier: 'web-browsing',
                  // No result - tool is still executing
                },
              ],
            },
          ],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should only create 1 assistant message (no tool message)
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('assistant');
      expect(result.messages[0].tools).toHaveLength(1);

      expect(result.metadata.assistantMessagesCreated).toBe(1);
      expect(result.metadata.toolMessagesCreated).toBe(0);
    });

    it('should handle tool result with error', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-group-1',
          role: 'assistantGroup',
          content: '',
          children: [
            {
              id: 'msg-1',
              content: '',
              tools: [
                {
                  id: 'tool-1',
                  type: 'builtin',
                  apiName: 'search',
                  arguments: '{}',
                  identifier: 'web-browsing',
                  result: {
                    id: 'msg-tool-1',
                    content: '',
                    error: { message: 'Network timeout' },
                    state: {},
                  },
                },
              ],
            },
          ],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
      const toolMsg = result.messages[1];
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.pluginError).toEqual({ message: 'Network timeout' });
    });
  });

  describe('Mixed Messages', () => {
    it('should preserve non-group messages and flatten group messages', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-user-1',
          role: 'user',
          content: 'What is the weather?',
        },
        {
          id: 'msg-group-1',
          role: 'assistantGroup',
          content: '',
          children: [
            {
              id: 'msg-1',
              content: 'Checking...',
              tools: [
                {
                  id: 'tool-1',
                  type: 'builtin',
                  apiName: 'search',
                  arguments: '{}',
                  identifier: 'web-browsing',
                  result: {
                    id: 'msg-tool-1',
                    content: 'Sunny',
                    error: null,
                    state: {},
                  },
                },
              ],
            },
          ],
        },
        {
          id: 'msg-user-2',
          role: 'user',
          content: 'Thanks!',
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // 1 user + (1 assistant + 1 tool) + 1 user = 4 messages
      expect(result.messages).toHaveLength(4);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].id).toBe('msg-user-1');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[2].role).toBe('tool');
      expect(result.messages[3].role).toBe('user');
      expect(result.messages[3].id).toBe('msg-user-2');
    });
  });

  describe('Edge Cases', () => {
    it('should handle group message with empty children array', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-group-1',
          role: 'assistantGroup',
          content: '',
          children: [],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Empty children means no messages created
      expect(result.messages).toHaveLength(0);
    });

    it('should handle group message without children field', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-group-1',
          role: 'assistantGroup',
          content: '',
          // No children field
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should keep the message as-is (though this is invalid data)
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe('msg-group-1');
    });

    it('should preserve reasoning field from child block', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-group-1',
          role: 'assistantGroup',
          content: '',
          children: [
            {
              id: 'msg-1',
              content: 'Result',
              reasoning: {
                content: 'Thinking about the query...',
                signature: 'sig-123',
              },
              tools: [],
            },
          ],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].reasoning).toEqual({
        content: 'Thinking about the query...',
        signature: 'sig-123',
      });
    });

    it('should preserve error field from child block', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-group-1',
          role: 'assistantGroup',
          content: '',
          children: [
            {
              id: 'msg-1',
              content: 'Error occurred',
              error: {
                type: 'InvalidAPIKey',
                message: 'API key is invalid',
              },
              tools: [],
            },
          ],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].error).toEqual({
        type: 'InvalidAPIKey',
        message: 'API key is invalid',
      });
    });

    it('should preserve imageList field from child block', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-group-1',
          role: 'assistantGroup',
          content: '',
          children: [
            {
              id: 'msg-1',
              content: 'Here are the images',
              imageList: [
                { id: 'img-1', url: 'https://example.com/img1.jpg', alt: 'Image 1' },
                { id: 'img-2', url: 'https://example.com/img2.jpg', alt: 'Image 2' },
              ],
              tools: [],
            },
          ],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].imageList).toEqual([
        { id: 'img-1', url: 'https://example.com/img1.jpg', alt: 'Image 1' },
        { id: 'img-2', url: 'https://example.com/img2.jpg', alt: 'Image 2' },
      ]);
    });

    it('should preserve parent/thread/group/topic IDs', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-group-1',
          role: 'assistantGroup',
          content: '',
          parentId: 'parent-1',
          threadId: 'thread-1',
          groupId: 'group-1',
          topicId: 'topic-1',
          children: [
            {
              id: 'msg-1',
              content: '',
              tools: [
                {
                  id: 'tool-1',
                  type: 'builtin',
                  apiName: 'search',
                  arguments: '{}',
                  identifier: 'web-browsing',
                  result: {
                    id: 'msg-tool-1',
                    content: 'Result',
                    error: null,
                    state: {},
                  },
                },
              ],
            },
          ],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      const assistantMsg = result.messages[0];
      expect(assistantMsg.parentId).toBe('parent-1');
      expect(assistantMsg.threadId).toBe('thread-1');
      expect(assistantMsg.groupId).toBe('group-1');
      expect(assistantMsg.topicId).toBe('topic-1');

      const toolMsg = result.messages[1];
      expect(toolMsg.parentId).toBe('parent-1');
      expect(toolMsg.threadId).toBe('thread-1');
      expect(toolMsg.groupId).toBe('group-1');
      expect(toolMsg.topicId).toBe('topic-1');
    });
  });

  describe('Supervisor Messages', () => {
    it('should flatten supervisor message with children', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-supervisor-1',
          role: 'supervisor',
          content: '',
          createdAt: '2025-10-27T10:00:00.000Z',
          updatedAt: '2025-10-27T10:00:10.000Z',
          meta: { title: 'Supervisor Agent' },
          children: [
            {
              id: 'msg-1',
              content: 'Let me coordinate the agents',
              tools: [
                {
                  id: 'tool-1',
                  type: 'builtin',
                  apiName: 'broadcast',
                  arguments: '{"message":"Hello agents"}',
                  identifier: 'lobe-group-management',
                  result: {
                    id: 'msg-tool-1',
                    content: 'Broadcast sent',
                    error: null,
                    state: {},
                  },
                },
              ],
              usage: { totalTokens: 100 },
            },
          ],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should create 2 messages: 1 assistant + 1 tool
      expect(result.messages).toHaveLength(2);

      // Check assistant message (supervisor gets flattened to assistant)
      const assistantMsg = result.messages[0];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.id).toBe('msg-1');
      expect(assistantMsg.content).toBe('Let me coordinate the agents');
      expect(assistantMsg.tools).toHaveLength(1);

      // Check tool message
      const toolMsg = result.messages[1];
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.id).toBe('msg-tool-1');
      expect(toolMsg.content).toBe('Broadcast sent');
    });

    it('should flatten supervisor message with content only (no tools)', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-supervisor-1',
          role: 'supervisor',
          content: '',
          children: [
            {
              id: 'msg-1',
              content: 'Anthropic cowork',
            },
          ],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should create 1 assistant message
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('assistant');
      expect(result.messages[0].content).toBe('Anthropic cowork');
    });

    it('should handle supervisor message with empty children', async () => {
      const processor = new GroupMessageFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-supervisor-1',
          role: 'supervisor',
          content: '',
          children: [],
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Empty children means no messages created
      expect(result.messages).toHaveLength(0);
    });
  });

  describe('Real-world Test Case', () => {
    it('should flatten the provided real-world group message', async () => {
      const processor = new GroupMessageFlattenProcessor();

      // Using the real-world test data provided
      const input: any[] = [
        {
          id: 'msg_LnIlOyMUnX1ylf',
          role: 'assistantGroup',
          content: '',
          createdAt: '2025-10-27T10:47:59.475Z',
          updatedAt: '2025-10-27T10:48:10.768Z',
          topicId: 'tpc_WQ1wRvxdDpLw',
          parentId: 'msg_ekwWzxAKueHkd6',
          meta: {
            avatar: '🤯',
            title: '随便聊聊',
          },
          children: [
            {
              content: '',
              id: 'msg_LnIlOyMUnX1ylf',
              reasoning: {
                content:
                  '**Checking Hangzhou weather**\n\nIt seems the user is asking to check the weather in Hangzhou...',
              },
              performance: {
                tps: 29.336734693877553,
                ttft: 3844,
                duration: 3920,
                latency: 7764,
              },
              tools: [
                {
                  id: 'call_kYZG2daTTfnkgNiN6oIR25YK',
                  type: 'builtin',
                  apiName: 'search',
                  arguments:
                    '{"query":"杭州 天气","searchCategories":["general"],"searchEngines":["google","bing"],"searchTimeRange":"day"}',
                  identifier: 'lobe-web-browsing',
                  result: {
                    content: '<searchResults>...</searchResults>',
                    error: null,
                    id: 'msg_DS234ZZMju1NNO',
                    state: {
                      query: '杭州 天气',
                      costTime: 1752,
                      resultNumbers: 600,
                    },
                  },
                },
              ],
              usage: {
                inputCacheMissTokens: 2404,
                totalTokens: 2519,
                cost: 0.000831,
              },
            },
          ],
          usage: {
            totalTokens: 2519,
            cost: 0.000831,
          },
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should create 2 messages
      expect(result.messages).toHaveLength(2);

      // Check assistant message
      const assistantMsg = result.messages[0];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.id).toBe('msg_LnIlOyMUnX1ylf');
      expect(assistantMsg.tools).toHaveLength(1);
      expect(assistantMsg.tools[0].identifier).toBe('lobe-web-browsing');
      expect(assistantMsg.tools[0].apiName).toBe('search');
      expect(assistantMsg.reasoning).toBeDefined();
      expect(assistantMsg.topicId).toBe('tpc_WQ1wRvxdDpLw');
      expect(assistantMsg.parentId).toBe('msg_ekwWzxAKueHkd6');

      // Check tool message
      const toolMsg = result.messages[1];
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.id).toBe('msg_DS234ZZMju1NNO');
      expect(toolMsg.tool_call_id).toBe('call_kYZG2daTTfnkgNiN6oIR25YK');
      expect(toolMsg.plugin).toBeDefined();
      expect(toolMsg.plugin.identifier).toBe('lobe-web-browsing');
      expect(toolMsg.pluginState).toBeDefined();
      expect(toolMsg.pluginState.query).toBe('杭州 天气');
    });
  });
});
