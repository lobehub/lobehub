import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { serverMessagesEngine } from '../index';

describe('serverMessagesEngine', () => {
  const createBasicMessages = (): UIChatMessage[] => [
    {
      content: 'Hello',
      createdAt: Date.now(),
      id: 'msg-1',
      role: 'user',
      updatedAt: Date.now(),
    } as UIChatMessage,
    {
      content: 'Hi there!',
      createdAt: Date.now(),
      id: 'msg-2',
      role: 'assistant',
      updatedAt: Date.now(),
    } as UIChatMessage,
  ];

  describe('basic functionality', () => {
    it('should process messages with required parameters', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      result.forEach((msg) => {
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
        // Should be cleaned up (no extra fields)
        expect(msg).not.toHaveProperty('createdAt');
        expect(msg).not.toHaveProperty('updatedAt');
      });
    });

    it('should inject system role', async () => {
      const messages = createBasicMessages();
      const systemRole = 'You are a helpful assistant';

      const result = await serverMessagesEngine({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        systemRole,
      });

      expect(result[0].role).toBe('system');
      expect(result[0].content).toBe(systemRole);
    });

    it('should handle empty messages', async () => {
      const result = await serverMessagesEngine({
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toEqual([]);
    });
  });

  describe('knowledge injection', () => {
    it('should inject file contents', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        knowledge: {
          fileContents: [
            {
              content: 'File content here',
              fileId: 'file-1',
              filename: 'test.txt',
            },
          ],
        },
        messages,
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
      });

      // Should have system message with knowledge
      const systemMessage = result.find((m) => m.role === 'system');
      expect(systemMessage).toBeDefined();
    });

    it('should inject knowledge bases', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        knowledge: {
          knowledgeBases: [
            {
              description: 'Test knowledge base',
              id: 'kb-1',
              name: 'Test KB',
            },
          ],
        },
        messages,
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
      });

      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('tools configuration', () => {
    it('should handle tools system roles', async () => {
      const messages = createBasicMessages();
      const mockManifests = [
        {
          identifier: 'tool1',
          api: [{ name: 'action', description: 'Tool 1 action', parameters: {} }],
          meta: { title: 'Tool 1' },
          type: 'default' as const,
          systemRole: 'Tool 1 instructions',
        },
        {
          identifier: 'tool2',
          api: [{ name: 'action', description: 'Tool 2 action', parameters: {} }],
          meta: { title: 'Tool 2' },
          type: 'default' as const,
        },
      ];

      const result = await serverMessagesEngine({
        capabilities: { isCanUseFC: () => true },
        messages,
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'Base system role',
        toolsConfig: {
          manifests: mockManifests,
          tools: ['tool1', 'tool2'],
        },
      });

      // Should inject tool system role when manifests are provided
      const systemMessage = result.find((msg) => msg.role === 'system');
      expect(systemMessage).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should skip tool system role when no manifests', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        toolsConfig: {
          manifests: [],
          tools: [],
        },
      });

      // Without manifests, no tool-related system role should be injected
      const systemMessages = result.filter((msg) => msg.role === 'system');
      const hasToolSystemRole = systemMessages.some((msg) => {
        const content = typeof msg.content === 'string' ? msg.content : '';
        return content.includes('plugins');
      });
      expect(hasToolSystemRole).toBe(false);
    });
  });

  describe('capabilities injection', () => {
    it('should use provided isCanUseFC', async () => {
      const messages = createBasicMessages();
      const isCanUseFC = vi.fn().mockReturnValue(true);

      await serverMessagesEngine({
        capabilities: { isCanUseFC },
        messages,
        model: 'gpt-4',
        provider: 'openai',
        toolsConfig: { tools: ['tool1'] },
      });

      expect(isCanUseFC).toHaveBeenCalled();
    });

    it('should default to true for capabilities when not provided', async () => {
      const messages = createBasicMessages();

      // Should not throw
      const result = await serverMessagesEngine({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toBeDefined();
    });
  });

  describe('user memory injection', () => {
    it('should inject user memories when provided', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        userMemory: {
          fetchedAt: Date.now(),
          memories: {
            contexts: [
              {
                description: 'Test context',
                id: 'ctx-1',
                title: 'Test',
              },
            ],
            experiences: [],
            preferences: [],
          },
        },
      });

      // User memories are injected as a consolidated user message before the first user message
      // Note: meta/id fields are removed by the engine cleanup step, so assert via content.
      const injection = result.find(
        (m: any) => m.role === 'user' && String(m.content).includes('<user_memory>'),
      );
      expect(injection).toBeDefined();
      expect(injection!.role).toBe('user');
    });

    it('should skip user memory when memories is undefined', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        userMemory: {
          fetchedAt: Date.now(),
          memories: undefined,
        },
      });

      // Should still work without memories
      expect(result).toBeDefined();
    });
  });

  describe('extended contexts', () => {
    it('should inject Agent Builder context when provided', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        agentBuilderContext: {
          config: { model: 'gpt-4', systemRole: 'Test role' },
          meta: { description: 'Test agent', title: 'Test' },
        },
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toBeDefined();
    });

    it('should inject Page Editor context when provided', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        messages,
        model: 'gpt-4',
        pageContentContext: {
          markdown: '# Test Document\n\nPage content',
          metadata: {
            charCount: 30,
            lineCount: 3,
            title: 'Test Document',
          },
          xml: '<doc><h1 id="1">Test Document</h1><p id="2">Page content</p></doc>',
        },
        provider: 'openai',
      });

      expect(result).toBeDefined();
    });
  });

  describe('input template', () => {
    it('should apply input template to user messages', async () => {
      const messages: UIChatMessage[] = [
        {
          content: 'user input',
          createdAt: Date.now(),
          id: 'msg-1',
          role: 'user',
          updatedAt: Date.now(),
        } as UIChatMessage,
      ];

      const result = await serverMessagesEngine({
        inputTemplate: 'Please respond to: {{text}}',
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      const userMessage = result.find((m) => m.role === 'user');
      expect(userMessage?.content).toBe('Please respond to: user input');
    });
  });

  describe('history summary', () => {
    it('should inject history summary when provided', async () => {
      const messages = createBasicMessages();
      const historySummary = 'Previous conversation about AI';

      const result = await serverMessagesEngine({
        historySummary,
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      // Should contain history summary in system message
      const systemMessages = result.filter((m) => m.role === 'system');
      const hasHistorySummary = systemMessages.some(
        (m) => typeof m.content === 'string' && m.content.includes(historySummary),
      );
      expect(hasHistorySummary).toBe(true);
    });

    it('should use custom formatHistorySummary', async () => {
      const messages = createBasicMessages();
      const historySummary = 'test summary';
      const formatHistorySummary = vi.fn((s: string) => `<custom>${s}</custom>`);

      await serverMessagesEngine({
        formatHistorySummary,
        historySummary,
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(formatHistorySummary).toHaveBeenCalledWith(historySummary);
    });
  });
});
