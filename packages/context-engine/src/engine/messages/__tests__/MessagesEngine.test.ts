import { describe, expect, it, vi } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

describe('MessagesEngine', () => {
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

  const createBasicParams = (overrides?: Partial<MessagesEngineParams>): MessagesEngineParams => ({
    messages: createBasicMessages(),
    model: 'gpt-4',
    provider: 'openai',
    ...overrides,
  });

  describe('constructor', () => {
    it('should initialize with required parameters', () => {
      const params = createBasicParams();
      const engine = new MessagesEngine(params);
      expect(engine).toBeInstanceOf(MessagesEngine);
    });

    it('should initialize with all optional parameters', () => {
      const params = createBasicParams({
        agentBuilderContext: { config: { model: 'gpt-4' } },
        capabilities: {
          isCanUseFC: () => true,
          isCanUseVideo: () => false,
          isCanUseVision: () => true,
        },
        enableHistoryCount: true,
        fileContext: { enabled: true, includeFileUrl: false },
        formatHistorySummary: (s) => `<summary>${s}</summary>`,
        historyCount: 10,
        historySummary: 'Previous conversation summary',
        inputTemplate: '{{text}}',
        knowledge: {
          fileContents: [{ content: 'test', fileId: 'f1', filename: 'test.txt' }],
          knowledgeBases: [{ id: 'kb1', name: 'Knowledge Base 1' }],
        },
        systemRole: 'You are a helpful assistant',
        toolsConfig: {
          manifests: [],
          tools: ['tool1'],
        },
        variableGenerators: {
          date: () => '2024-01-01',
        },
      });

      const engine = new MessagesEngine(params);
      expect(engine).toBeInstanceOf(MessagesEngine);
    });
  });

  describe('process', () => {
    it('should process messages and return result with stats', async () => {
      const params = createBasicParams();
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.stats).toBeDefined();
      expect(result.stats.processedCount).toBeGreaterThan(0);
      expect(result.stats.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('should clean up messages to OpenAI format', async () => {
      const params = createBasicParams();
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      // Messages should be cleaned up
      result.messages.forEach((msg) => {
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
        // Should not have extra fields like createdAt, updatedAt after cleanup
        expect(msg).not.toHaveProperty('createdAt');
        expect(msg).not.toHaveProperty('updatedAt');
      });
    });

    it('should inject system role when provided', async () => {
      const systemRole = 'You are a helpful assistant';
      const params = createBasicParams({ systemRole });
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      // First message should be system role
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe(systemRole);
    });

    it('should inject history summary when provided', async () => {
      const historySummary = 'We discussed AI and machine learning';
      const params = createBasicParams({ historySummary });
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      // Should contain history summary in system message
      const systemMessages = result.messages.filter((m) => m.role === 'system');
      const hasHistorySummary = systemMessages.some(
        (m) => typeof m.content === 'string' && m.content.includes(historySummary),
      );
      expect(hasHistorySummary).toBe(true);
    });

    it('should use custom formatHistorySummary when provided', async () => {
      const historySummary = 'test summary';
      const formatHistorySummary = vi.fn((s: string) => `<custom>${s}</custom>`);

      const params = createBasicParams({
        formatHistorySummary,
        historySummary,
      });
      const engine = new MessagesEngine(params);

      await engine.process();

      expect(formatHistorySummary).toHaveBeenCalledWith(historySummary);
    });

    it('should handle empty messages', async () => {
      const params = createBasicParams({ messages: [] });
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      expect(result.messages).toEqual([]);
    });
  });

  describe('processMessages', () => {
    it('should return only messages array', async () => {
      const params = createBasicParams();
      const engine = new MessagesEngine(params);

      const messages = await engine.processMessages();

      expect(Array.isArray(messages)).toBe(true);
      messages.forEach((msg) => {
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
      });
    });
  });

  describe('capabilities injection', () => {
    it('should use provided isCanUseFC', async () => {
      const isCanUseFC = vi.fn().mockReturnValue(true);
      const params = createBasicParams({
        capabilities: { isCanUseFC },
        toolsConfig: { tools: ['tool1'] },
      });
      const engine = new MessagesEngine(params);

      await engine.process();

      // isCanUseFC should be called during tool processing
      expect(isCanUseFC).toHaveBeenCalled();
    });

    it('should use provided isCanUseVision', async () => {
      const isCanUseVision = vi.fn().mockReturnValue(true);
      const messages: UIChatMessage[] = [
        {
          content: 'Check this image',
          createdAt: Date.now(),
          id: 'msg-1',
          imageList: [{ id: 'img-1', url: 'https://example.com/image.png' }],
          role: 'user',
          updatedAt: Date.now(),
        } as unknown as UIChatMessage,
      ];

      const params = createBasicParams({
        capabilities: { isCanUseVision },
        messages,
      });
      const engine = new MessagesEngine(params);

      await engine.process();

      expect(isCanUseVision).toHaveBeenCalled();
    });

    it('should default to true for isCanUseFC when not provided', async () => {
      const params = createBasicParams({
        toolsConfig: { tools: ['tool1'] },
      });
      const engine = new MessagesEngine(params);

      // Should not throw
      const result = await engine.process();
      expect(result).toBeDefined();
    });
  });

  describe('variable generators', () => {
    it('should replace placeholders with generated values', async () => {
      const messages: UIChatMessage[] = [
        {
          content: 'Today is {{date}}',
          createdAt: Date.now(),
          id: 'msg-1',
          role: 'user',
          updatedAt: Date.now(),
        } as UIChatMessage,
      ];

      const params = createBasicParams({
        messages,
        variableGenerators: {
          date: () => '2024-01-01',
        },
      });
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      const userMessage = result.messages.find((m) => m.role === 'user');
      expect(userMessage?.content).toBe('Today is 2024-01-01');
    });
  });

  describe('knowledge injection', () => {
    it('should inject file contents', async () => {
      const params = createBasicParams({
        knowledge: {
          fileContents: [
            {
              content: 'File content here',
              fileId: 'file-1',
              filename: 'test.txt',
            },
          ],
        },
      });
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      // Should have knowledge injected
      expect(result.metadata.knowledgeInjected).toBe(true);
    });

    it('should inject knowledge bases', async () => {
      const params = createBasicParams({
        knowledge: {
          knowledgeBases: [
            {
              description: 'Test knowledge base',
              id: 'kb-1',
              name: 'Test KB',
            },
          ],
        },
      });
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      expect(result.metadata.knowledgeInjected).toBe(true);
    });
  });

  describe('Agent Builder context', () => {
    it('should inject Agent Builder context when provided', async () => {
      const params = createBasicParams({
        agentBuilderContext: {
          config: { model: 'gpt-4', systemRole: 'Test role' },
          meta: { description: 'Test agent', title: 'Test' },
        },
      });
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      expect(result.metadata.agentBuilderContextInjected).toBe(true);
    });

    it('should not inject Agent Builder context when not provided', async () => {
      const params = createBasicParams();
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      expect(result.metadata.agentBuilderContextInjected).toBeUndefined();
    });
  });

  describe('file context', () => {
    it('should use provided file context config', async () => {
      const params = createBasicParams({
        fileContext: {
          enabled: true,
          includeFileUrl: false,
        },
      });
      const engine = new MessagesEngine(params);

      // Should not throw
      const result = await engine.process();
      expect(result).toBeDefined();
    });

    it('should default to enabled with includeFileUrl true', async () => {
      const params = createBasicParams();
      const engine = new MessagesEngine(params);

      // Should not throw
      const result = await engine.process();
      expect(result).toBeDefined();
    });
  });

  describe('tools config', () => {
    it('should handle tools configuration with manifests', async () => {
      const mockManifests = [
        {
          identifier: 'tool1',
          api: [{ name: 'action', description: 'Tool 1 action', parameters: {} }],
          meta: { title: 'Tool 1' },
          type: 'default' as const,
        },
        {
          identifier: 'tool2',
          api: [{ name: 'action', description: 'Tool 2 action', parameters: {} }],
          meta: { title: 'Tool 2' },
          type: 'default' as const,
        },
      ];

      const params = createBasicParams({
        capabilities: { isCanUseFC: () => true },
        toolsConfig: {
          manifests: mockManifests,
          tools: ['tool1', 'tool2'],
        },
      });
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      // Should inject tool system role when manifests are provided
      const systemMessage = result.messages.find((msg) => msg.role === 'system');
      expect(systemMessage).toBeDefined();
      expect(systemMessage!.content).toContain('tool1');
    });

    it('should skip tool system role provider when no tools', async () => {
      const params = createBasicParams({
        toolsConfig: { tools: [] },
      });
      const engine = new MessagesEngine(params);

      // Should not throw
      const result = await engine.process();
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

      const params = createBasicParams({
        inputTemplate: 'Please respond to: {{text}}',
        messages,
      });
      const engine = new MessagesEngine(params);

      const result = await engine.process();

      const userMessage = result.messages.find((m) => m.role === 'user');
      expect(userMessage?.content).toBe('Please respond to: user input');
    });
  });
});
