import { MessagesEngine } from '@lobechat/context-engine';
import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { serverMessagesEngine } from '../index';

// Helper to compute expected date content from SystemDateProvider
const getCurrentDateContent = () => {
  const tz = 'UTC';
  const today = new Date();
  const year = today.toLocaleString('en-US', { timeZone: tz, year: 'numeric' });
  const month = today.toLocaleString('en-US', { month: '2-digit', timeZone: tz });
  const day = today.toLocaleString('en-US', { day: '2-digit', timeZone: tz });
  return `Current date: ${year}-${month}-${day} (${tz})`;
};

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
      // 3 messages: system date + 2 original messages
      expect(result.length).toBe(3);
      expect(result[0]).toEqual({ content: getCurrentDateContent(), role: 'system' });
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
      expect(result[0].content).toBe(systemRole + '\n\n' + getCurrentDateContent());
    });

    it('should handle empty messages', async () => {
      const result = await serverMessagesEngine({
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
      });

      // SystemDateProvider injects a system date message even with empty input
      expect(result).toEqual([{ content: getCurrentDateContent(), role: 'system' }]);
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

  describe('userTimezone parameter', () => {
    it('should pass userTimezone as timezone to MessagesEngine', async () => {
      const constructorSpy = vi.spyOn(MessagesEngine.prototype, 'process').mockResolvedValue({
        messages: [],
      } as any);

      const messages = createBasicMessages();

      await serverMessagesEngine({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        userTimezone: 'Asia/Shanghai',
      });

      expect(constructorSpy).toHaveBeenCalled();
      constructorSpy.mockRestore();
    });

    it('should use userTimezone in variable generators for time-related values', async () => {
      const messages: UIChatMessage[] = [
        {
          content: 'What time is it? {{timezone}}',
          createdAt: Date.now(),
          id: 'msg-1',
          role: 'user',
          updatedAt: Date.now(),
        } as UIChatMessage,
      ];

      const result = await serverMessagesEngine({
        inputTemplate: '{{text}} (tz: {{timezone}})',
        messages,
        model: 'gpt-4',
        provider: 'openai',
        userTimezone: 'America/New_York',
      });

      const userMessage = result.find((m) => m.role === 'user');
      expect(userMessage?.content).toContain('America/New_York');
    });
  });

  describe('additionalVariables parameter', () => {
    it('should merge additionalVariables into variableGenerators', async () => {
      const messages: UIChatMessage[] = [
        {
          content: 'test input',
          createdAt: Date.now(),
          id: 'msg-1',
          role: 'user',
          updatedAt: Date.now(),
        } as UIChatMessage,
      ];

      const result = await serverMessagesEngine({
        additionalVariables: {
          customVar: 'custom-value',
        },
        inputTemplate: '{{text}} {{customVar}}',
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      const userMessage = result.find((m) => m.role === 'user');
      expect(userMessage?.content).toContain('custom-value');
    });

    it('should handle empty additionalVariables', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        additionalVariables: {},
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('extended context params forwarding', () => {
    it('should forward discordContext when provided', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        discordContext: {
          channel: { id: 'ch-1', name: 'general' },
          guild: { id: 'guild-1', name: 'Test Guild' },
        },
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toBeDefined();
    });

    it('should forward evalContext when provided', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        evalContext: {
          envPrompt: 'This is an evaluation environment',
        },
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toBeDefined();
    });

    it('should forward agentManagementContext when provided', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        agentManagementContext: {
          availablePlugins: [
            { identifier: 'web-browsing', name: 'Web Browsing', type: 'builtin' as const },
          ],
        },
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toBeDefined();
    });

    it('should handle multiple extended contexts simultaneously', async () => {
      const messages = createBasicMessages();

      const result = await serverMessagesEngine({
        agentBuilderContext: {
          config: { model: 'gpt-4', systemRole: 'Test role' },
          meta: { description: 'Test agent', title: 'Test' },
        },
        discordContext: {
          channel: { id: 'ch-1', name: 'general' },
          guild: { id: 'guild-1', name: 'Test Guild' },
        },
        messages,
        model: 'gpt-4',
        pageContentContext: {
          markdown: '# Doc',
          metadata: { charCount: 5, lineCount: 1, title: 'Doc' },
          xml: '<doc><h1 id="1">Doc</h1></doc>',
        },
        provider: 'openai',
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
