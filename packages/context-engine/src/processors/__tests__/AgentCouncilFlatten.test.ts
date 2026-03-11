import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { AgentCouncilFlattenProcessor } from '../AgentCouncilFlatten';

describe('AgentCouncilFlattenProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  describe('Basic Scenarios', () => {
    it('should flatten agentCouncil message with multiple simple members', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      const input: any[] = [
        {
          content: '',
          createdAt: 1704067205000,
          extra: {
            parentMessageId: 'msg-broadcast-tool-1',
          },
          id: 'agentCouncil-msg-1',
          members: [
            {
              id: 'msg-agent-backend-1',
              role: 'assistant',
              agentId: 'agent-backend',
              content: 'Backend perspective content',
              parentId: 'msg-broadcast-tool-1',
              model: 'gpt-4',
              provider: 'openai',
              createdAt: 1704067205000,
              updatedAt: 1704067205000,
              meta: {
                avatar: 'backend-dev',
                title: 'Backend Developer',
              },
            },
            {
              id: 'msg-agent-devops-1',
              role: 'assistant',
              agentId: 'agent-devops',
              content: 'DevOps perspective content',
              parentId: 'msg-broadcast-tool-1',
              model: 'claude-3-5-sonnet-20241022',
              provider: 'anthropic',
              createdAt: 1704067205500,
              updatedAt: 1704067205500,
              meta: {
                avatar: 'devops',
                title: 'DevOps Engineer',
              },
            },
          ],
          role: 'agentCouncil',
          updatedAt: 1704067206000,
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should create 2 assistant messages
      expect(result.messages).toHaveLength(2);

      // Check first assistant message
      const assistantMsg1 = result.messages[0];
      expect(assistantMsg1.role).toBe('assistant');
      expect(assistantMsg1.id).toBe('msg-agent-backend-1');
      expect(assistantMsg1.content).toBe('Backend perspective content');
      expect(assistantMsg1.agentId).toBe('agent-backend');
      expect(assistantMsg1.model).toBe('gpt-4');
      expect(assistantMsg1.provider).toBe('openai');
      expect(assistantMsg1.meta.title).toBe('Backend Developer');

      // Check second assistant message
      const assistantMsg2 = result.messages[1];
      expect(assistantMsg2.role).toBe('assistant');
      expect(assistantMsg2.id).toBe('msg-agent-devops-1');
      expect(assistantMsg2.content).toBe('DevOps perspective content');
      expect(assistantMsg2.agentId).toBe('agent-devops');
      expect(assistantMsg2.model).toBe('claude-3-5-sonnet-20241022');
      expect(assistantMsg2.provider).toBe('anthropic');

      // Check metadata
      expect(result.metadata.agentCouncilMessagesFlattened).toBe(1);
      expect(result.metadata.agentCouncilAssistantMessagesCreated).toBe(2);
      expect(result.metadata.agentCouncilToolMessagesCreated).toBe(0);
    });

    it('should flatten agentCouncil message with member having tools', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      const input: any[] = [
        {
          content: '',
          createdAt: 1704067205000,
          extra: {
            parentMessageId: 'msg-broadcast-tool-1',
          },
          id: 'agentCouncil-msg-1',
          members: [
            {
              id: 'msg-agent-1',
              role: 'assistant',
              agentId: 'agent-1',
              content: 'Let me search for that',
              parentId: 'msg-broadcast-tool-1',
              createdAt: 1704067205000,
              updatedAt: 1704067205000,
              tools: [
                {
                  id: 'tool-1',
                  type: 'builtin',
                  apiName: 'search',
                  arguments: '{"query":"test"}',
                  identifier: 'web-browsing',
                  result: {
                    id: 'msg-tool-1',
                    content: 'Search result',
                    error: null,
                    state: { cached: true },
                  },
                },
              ],
            },
          ],
          role: 'agentCouncil',
          updatedAt: 1704067206000,
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should create 2 messages: 1 assistant + 1 tool
      expect(result.messages).toHaveLength(2);

      // Check assistant message
      const assistantMsg = result.messages[0];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.tools).toHaveLength(1);
      expect(assistantMsg.tools[0].id).toBe('tool-1');

      // Check tool message
      const toolMsg = result.messages[1];
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.id).toBe('msg-tool-1');
      expect(toolMsg.content).toBe('Search result');
      expect(toolMsg.tool_call_id).toBe('tool-1');
      expect(toolMsg.plugin.identifier).toBe('web-browsing');
      expect(toolMsg.pluginState).toEqual({ cached: true });

      expect(result.metadata.agentCouncilAssistantMessagesCreated).toBe(1);
      expect(result.metadata.agentCouncilToolMessagesCreated).toBe(1);
    });

    it('should flatten agentCouncil with assistantGroup member', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      const input: any[] = [
        {
          content: '',
          createdAt: 1704067205000,
          extra: {
            parentMessageId: 'msg-broadcast-tool-1',
          },
          id: 'agentCouncil-msg-1',
          members: [
            {
              // assistantGroup member (agent that used tools)
              id: 'msg-agent-group-1',
              role: 'assistantGroup',
              agentId: 'agent-with-tools',
              content: '',
              parentId: 'msg-broadcast-tool-1',
              createdAt: 1704067205000,
              updatedAt: 1704067205000,
              meta: { title: 'Agent with Tools' },
              children: [
                {
                  id: 'child-1',
                  content: 'Checking something',
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
              ],
            },
          ],
          role: 'agentCouncil',
          updatedAt: 1704067206000,
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should create 2 messages: 1 assistant + 1 tool
      expect(result.messages).toHaveLength(2);

      const assistantMsg = result.messages[0];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.id).toBe('child-1');
      expect(assistantMsg.content).toBe('Checking something');
      expect(assistantMsg.agentId).toBe('agent-with-tools');

      const toolMsg = result.messages[1];
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.id).toBe('msg-tool-1');
    });
  });

  describe('Mixed Messages', () => {
    it('should preserve non-agentCouncil messages and flatten agentCouncil messages', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      const input: any[] = [
        {
          id: 'msg-user-1',
          role: 'user',
          content: 'Ask everyone about this topic',
        },
        {
          content: '',
          createdAt: 1704067205000,
          extra: {
            parentMessageId: 'msg-broadcast-tool-1',
          },
          id: 'agentCouncil-msg-1',
          members: [
            {
              id: 'msg-agent-1',
              role: 'assistant',
              content: 'Response from agent 1',
            },
            {
              id: 'msg-agent-2',
              role: 'assistant',
              content: 'Response from agent 2',
            },
          ],
          role: 'agentCouncil',
          updatedAt: 1704067206000,
        },
        {
          id: 'msg-user-2',
          role: 'user',
          content: 'Thanks for the responses!',
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // 1 user + 2 assistants + 1 user = 4 messages
      expect(result.messages).toHaveLength(4);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].id).toBe('msg-user-1');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].id).toBe('msg-agent-1');
      expect(result.messages[2].role).toBe('assistant');
      expect(result.messages[2].id).toBe('msg-agent-2');
      expect(result.messages[3].role).toBe('user');
      expect(result.messages[3].id).toBe('msg-user-2');
    });
  });

  describe('Edge Cases', () => {
    it('should handle agentCouncil message with empty members array', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      const input: any[] = [
        {
          content: '',
          id: 'agentCouncil-msg-1',
          members: [],
          role: 'agentCouncil',
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Empty members means no messages created
      expect(result.messages).toHaveLength(0);
    });

    it('should handle agentCouncil message without members field', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      const input: any[] = [
        {
          content: '',
          id: 'agentCouncil-msg-1',
          role: 'agentCouncil',
          // No members field
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should keep the message as-is (though this is invalid data)
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe('agentCouncil-msg-1');
    });

    it('should preserve reasoning field from member', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      const input: any[] = [
        {
          content: '',
          id: 'agentCouncil-msg-1',
          members: [
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'Result',
              reasoning: {
                content: 'Thinking about the query...',
                signature: 'sig-123',
              },
            },
          ],
          role: 'agentCouncil',
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

    it('should preserve error field from member', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      const input: any[] = [
        {
          content: '',
          id: 'agentCouncil-msg-1',
          members: [
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'Error occurred',
              error: {
                type: 'InvalidAPIKey',
                message: 'API key is invalid',
              },
            },
          ],
          role: 'agentCouncil',
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

    it('should preserve imageList field from member', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      const input: any[] = [
        {
          content: '',
          id: 'agentCouncil-msg-1',
          members: [
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'Here are the images',
              imageList: [
                { id: 'img-1', url: 'https://example.com/img1.jpg', alt: 'Image 1' },
                { id: 'img-2', url: 'https://example.com/img2.jpg', alt: 'Image 2' },
              ],
            },
          ],
          role: 'agentCouncil',
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

    it('should preserve parent/thread/group/topic IDs from member', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      const input: any[] = [
        {
          content: '',
          id: 'agentCouncil-msg-1',
          members: [
            {
              id: 'msg-1',
              role: 'assistant',
              content: '',
              parentId: 'parent-1',
              threadId: 'thread-1',
              groupId: 'group-1',
              topicId: 'topic-1',
            },
          ],
          role: 'agentCouncil',
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      const assistantMsg = result.messages[0];
      expect(assistantMsg.parentId).toBe('parent-1');
      expect(assistantMsg.threadId).toBe('thread-1');
      expect(assistantMsg.groupId).toBe('group-1');
      expect(assistantMsg.topicId).toBe('topic-1');
    });

    it('should handle assistantGroup member with empty children', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      const input: any[] = [
        {
          content: '',
          id: 'agentCouncil-msg-1',
          members: [
            {
              id: 'msg-group-1',
              role: 'assistantGroup',
              content: '',
              children: [],
            },
          ],
          role: 'agentCouncil',
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Empty children in assistantGroup means no messages from that member
      expect(result.messages).toHaveLength(0);
    });
  });

  describe('Real-world Test Case', () => {
    it('should flatten the agentCouncil message from broadcast scenario', async () => {
      const processor = new AgentCouncilFlattenProcessor();

      // Based on the fixture from conversation-flow
      const input: any[] = [
        {
          content: '',
          createdAt: 1704067205000,
          extra: {
            parentMessageId: 'msg-broadcast-tool-1',
          },
          id: 'agentCouncil-msg-broadcast-tool-1-msg-agent-backend-1-msg-agent-devops-1-msg-agent-architect-1',
          members: [
            {
              id: 'msg-agent-backend-1',
              role: 'assistant',
              agentId: 'agent-backend',
              content:
                "**From a Backend Developer's Perspective:**\n\n**Pros:**\n- Independent deployment of services\n- Technology flexibility per service\n- Better fault isolation\n- Easier to scale specific services\n\n**Cons:**\n- Increased complexity in service communication\n- Data consistency challenges\n- More complex debugging and monitoring\n- Network latency between services",
              parentId: 'msg-broadcast-tool-1',
              model: 'gpt-4',
              provider: 'openai',
              createdAt: 1704067205000,
              updatedAt: 1704067205000,
              meta: {
                avatar: 'backend-dev',
                title: 'Backend Developer',
              },
              metadata: {
                totalInputTokens: 50,
                totalOutputTokens: 120,
                totalTokens: 170,
                tps: 45,
                ttft: 350,
                duration: 2667,
                latency: 3017,
              },
            },
            {
              id: 'msg-agent-devops-1',
              role: 'assistant',
              agentId: 'agent-devops',
              content:
                "**From a DevOps Engineer's Perspective:**\n\n**Pros:**\n- CI/CD pipelines can be service-specific\n- Container orchestration fits naturally\n- Auto-scaling at service level\n- Blue-green deployments are easier\n\n**Cons:**\n- Complex infrastructure management\n- More services = more monitoring overhead\n- Configuration management complexity\n- Increased resource consumption (each service needs its own runtime)",
              parentId: 'msg-broadcast-tool-1',
              model: 'claude-3-5-sonnet-20241022',
              provider: 'anthropic',
              createdAt: 1704067205500,
              updatedAt: 1704067205500,
              meta: {
                avatar: 'devops',
                title: 'DevOps Engineer',
              },
              metadata: {
                totalInputTokens: 50,
                totalOutputTokens: 130,
                totalTokens: 180,
                tps: 52,
                ttft: 280,
                duration: 2500,
                latency: 2780,
              },
            },
            {
              id: 'msg-agent-architect-1',
              role: 'assistant',
              agentId: 'agent-architect',
              content:
                "**From a Software Architect's Perspective:**\n\n**Pros:**\n- Clear service boundaries and ownership\n- Supports domain-driven design\n- Teams can work independently\n- Easier to understand individual services\n\n**Cons:**\n- Requires careful API versioning strategy\n- Cross-cutting concerns need special handling\n- Service discovery and load balancing complexity\n- Initial design requires significant upfront investment",
              parentId: 'msg-broadcast-tool-1',
              model: 'gpt-4',
              provider: 'openai',
              createdAt: 1704067206000,
              updatedAt: 1704067206000,
              meta: {
                avatar: 'architect',
                title: 'Software Architect',
              },
              metadata: {
                totalInputTokens: 50,
                totalOutputTokens: 125,
                totalTokens: 175,
                tps: 48,
                ttft: 320,
                duration: 2604,
                latency: 2924,
              },
            },
          ],
          role: 'agentCouncil',
          updatedAt: 1704067206000,
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should create 3 assistant messages (one from each agent)
      expect(result.messages).toHaveLength(3);

      // Verify all messages have correct role
      expect(result.messages.every((m: any) => m.role === 'assistant')).toBe(true);

      // Check first agent (Backend Developer)
      expect(result.messages[0].id).toBe('msg-agent-backend-1');
      expect(result.messages[0].agentId).toBe('agent-backend');
      expect(result.messages[0].model).toBe('gpt-4');
      expect(result.messages[0].provider).toBe('openai');
      expect(result.messages[0].meta.title).toBe('Backend Developer');
      expect(result.messages[0].content).toContain('Backend Developer');

      // Check second agent (DevOps Engineer)
      expect(result.messages[1].id).toBe('msg-agent-devops-1');
      expect(result.messages[1].agentId).toBe('agent-devops');
      expect(result.messages[1].model).toBe('claude-3-5-sonnet-20241022');
      expect(result.messages[1].provider).toBe('anthropic');
      expect(result.messages[1].meta.title).toBe('DevOps Engineer');

      // Check third agent (Software Architect)
      expect(result.messages[2].id).toBe('msg-agent-architect-1');
      expect(result.messages[2].agentId).toBe('agent-architect');
      expect(result.messages[2].meta.title).toBe('Software Architect');

      // Check metadata
      expect(result.metadata.agentCouncilMessagesFlattened).toBe(1);
      expect(result.metadata.agentCouncilAssistantMessagesCreated).toBe(3);
      expect(result.metadata.agentCouncilToolMessagesCreated).toBe(0);
    });
  });
});
