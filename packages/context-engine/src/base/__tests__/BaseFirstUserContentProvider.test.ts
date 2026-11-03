import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { BaseFirstUserContentProvider } from '../BaseFirstUserContentProvider';

class TestFirstUserContentProvider extends BaseFirstUserContentProvider {
  readonly name = 'TestFirstUserContentProvider';
  private contentToReturn: string | null = 'Test content';

  setContent(content: string | null) {
    this.contentToReturn = content;
  }

  protected buildContent(_context: PipelineContext): string | null {
    return this.contentToReturn;
  }

  // Expose protected methods for testing
  testFindFirstUserMessageIndex(messages: any[]) {
    return this.findFirstUserMessageIndex(messages);
  }

  testFindSystemInjectionMessage(messages: any[]) {
    return this.findSystemInjectionMessage(messages);
  }

  testFindSystemInjectionMessageIndex(messages: any[]) {
    return this.findSystemInjectionMessageIndex(messages);
  }

  testCreateSystemInjectionMessage(content: string) {
    return this.createSystemInjectionMessage(content);
  }

  testAppendToMessage(message: any, content: string) {
    return this.appendToMessage(message, content);
  }
}

// Second provider for testing multiple injections
class SecondFirstUserContentProvider extends BaseFirstUserContentProvider {
  readonly name = 'SecondFirstUserContentProvider';

  protected buildContent(_context: PipelineContext): string | null {
    return 'Second content';
  }
}

describe('BaseFirstUserContentProvider', () => {
  const createContext = (messages: any[] = []): PipelineContext => ({
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

  describe('findFirstUserMessageIndex', () => {
    it('should find the first user message in a simple conversation', () => {
      const provider = new TestFirstUserContentProvider();
      const messages = [
        { content: 'System prompt', role: 'system' },
        { content: 'Hello', role: 'user' },
        { content: 'Hi there', role: 'assistant' },
        { content: 'How are you?', role: 'user' },
      ];

      const index = provider.testFindFirstUserMessageIndex(messages);
      expect(index).toBe(1);
    });

    it('should find the first user message when it is at the beginning', () => {
      const provider = new TestFirstUserContentProvider();
      const messages = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi there', role: 'assistant' },
      ];

      const index = provider.testFindFirstUserMessageIndex(messages);
      expect(index).toBe(0);
    });

    it('should return -1 when no user messages exist', () => {
      const provider = new TestFirstUserContentProvider();
      const messages = [
        { content: 'System prompt', role: 'system' },
        { content: 'Assistant response', role: 'assistant' },
      ];

      const index = provider.testFindFirstUserMessageIndex(messages);
      expect(index).toBe(-1);
    });

    it('should return -1 for empty messages array', () => {
      const provider = new TestFirstUserContentProvider();
      const index = provider.testFindFirstUserMessageIndex([]);
      expect(index).toBe(-1);
    });
  });

  describe('findSystemInjectionMessage', () => {
    it('should find existing system injection message', () => {
      const provider = new TestFirstUserContentProvider();
      const messages = [
        { content: 'System prompt', role: 'system' },
        { content: 'Injected content', meta: { systemInjection: true }, role: 'user' },
        { content: 'User message', role: 'user' },
      ];

      const message = provider.testFindSystemInjectionMessage(messages);
      expect(message).toBeDefined();
      expect(message?.content).toBe('Injected content');
    });

    it('should return undefined when no system injection message exists', () => {
      const provider = new TestFirstUserContentProvider();
      const messages = [
        { content: 'System prompt', role: 'system' },
        { content: 'User message', role: 'user' },
      ];

      const message = provider.testFindSystemInjectionMessage(messages);
      expect(message).toBeUndefined();
    });
  });

  describe('createSystemInjectionMessage', () => {
    it('should create a properly structured message', () => {
      const provider = new TestFirstUserContentProvider();
      const message = provider.testCreateSystemInjectionMessage('Test content');

      expect(message.content).toBe('Test content');
      expect(message.role).toBe('user');
      expect(message.meta?.systemInjection).toBe(true);
      expect(message.id).toContain('system-injection-');
      expect(message.createdAt).toBeDefined();
      expect(message.updatedAt).toBeDefined();
    });
  });

  describe('appendToMessage', () => {
    it('should append content to string message content', () => {
      const provider = new TestFirstUserContentProvider();
      const message = { content: 'Original content', role: 'user' };

      const result = provider.testAppendToMessage(message, 'Appended content');

      expect(result.content).toBe('Original content\n\nAppended content');
    });

    it('should append content to array message content with text part', () => {
      const provider = new TestFirstUserContentProvider();
      const message = {
        content: [
          { text: 'Original text', type: 'text' },
          { image_url: { url: 'http://example.com/image.png' }, type: 'image_url' },
        ],
        role: 'user',
      };

      const result = provider.testAppendToMessage(message, 'Appended content');

      expect(result.content[0].text).toBe('Original text\n\nAppended content');
      expect(result.content[1].type).toBe('image_url');
    });

    it('should add new text part when array content has no text part', () => {
      const provider = new TestFirstUserContentProvider();
      const message = {
        content: [{ image_url: { url: 'http://example.com/image.png' }, type: 'image_url' }],
        role: 'user',
      };

      const result = provider.testAppendToMessage(message, 'Appended content');

      expect(result.content).toHaveLength(2);
      expect(result.content[1]).toEqual({
        text: 'Appended content',
        type: 'text',
      });
    });

    it('should append to last text part in multimodal message', () => {
      const provider = new TestFirstUserContentProvider();
      const message = {
        content: [
          { text: 'First text', type: 'text' },
          { image_url: { url: 'http://example.com/image.png' }, type: 'image_url' },
          { text: 'Last text', type: 'text' },
        ],
        role: 'user',
      };

      const result = provider.testAppendToMessage(message, 'Appended content');

      expect(result.content[2].text).toBe('Last text\n\nAppended content');
      expect(result.content[0].text).toBe('First text');
    });
  });

  describe('process integration', () => {
    it('should insert new message before first user message when no injection exists', async () => {
      const provider = new TestFirstUserContentProvider();
      const context = createContext([
        { content: 'System prompt', role: 'system' },
        { content: 'User question', role: 'user' },
        { content: 'Assistant response', role: 'assistant' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(4);
      expect(result.messages[0].content).toBe('System prompt');
      expect(result.messages[1].content).toBe('Test content');
      expect(result.messages[1].meta?.systemInjection).toBe(true);
      expect(result.messages[2].content).toBe('User question');
    });

    it('should append to existing injection message when it exists', async () => {
      const provider = new TestFirstUserContentProvider();
      const context = createContext([
        { content: 'System prompt', role: 'system' },
        { content: 'First injection', meta: { systemInjection: true }, role: 'user' },
        { content: 'User question', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[1].content).toBe('First injection\n\nTest content');
      expect(result.messages[1].meta?.systemInjection).toBe(true);
    });

    it('should skip injection when buildContent returns null', async () => {
      const provider = new TestFirstUserContentProvider();
      provider.setContent(null);

      const context = createContext([
        { content: 'System prompt', role: 'system' },
        { content: 'User question', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('System prompt');
      expect(result.messages[1].content).toBe('User question');
    });

    it('should skip injection when no user messages exist', async () => {
      const provider = new TestFirstUserContentProvider();
      const context = createContext([
        { content: 'System prompt', role: 'system' },
        { content: 'Assistant response', role: 'assistant' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(2);
    });

    it('should insert before first user message even when there is no system message', async () => {
      const provider = new TestFirstUserContentProvider();
      const context = createContext([
        { content: 'User question', role: 'user' },
        { content: 'Assistant response', role: 'assistant' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].content).toBe('Test content');
      expect(result.messages[0].meta?.systemInjection).toBe(true);
      expect(result.messages[1].content).toBe('User question');
    });
  });

  describe('multiple providers injection', () => {
    it('should consolidate content from multiple providers into single message', async () => {
      const provider1 = new TestFirstUserContentProvider();
      const provider2 = new SecondFirstUserContentProvider();

      const context = createContext([
        { content: 'System prompt', role: 'system' },
        { content: 'User question', role: 'user' },
      ]);

      // First provider creates injection message
      const result1 = await provider1.process(context);
      // Second provider appends to existing injection message
      const result2 = await provider2.process(result1);

      expect(result2.messages).toHaveLength(3);
      expect(result2.messages[1].content).toBe('Test content\n\nSecond content');
      expect(result2.messages[1].meta?.systemInjection).toBe(true);
      expect(result2.messages[2].content).toBe('User question');
    });

    it('should maintain correct order with multiple providers', async () => {
      const provider1 = new TestFirstUserContentProvider();
      provider1.setContent('<user_memories>Memory content</user_memories>');

      const provider2 = new SecondFirstUserContentProvider();

      const context = createContext([
        { content: 'System prompt', role: 'system' },
        { content: 'User question', role: 'user' },
      ]);

      const result1 = await provider1.process(context);
      const result2 = await provider2.process(result1);

      const injectedContent = result2.messages[1].content as string;
      expect(injectedContent).toContain('<user_memories>Memory content</user_memories>');
      expect(injectedContent).toContain('Second content');
      // First provider's content should come before second provider's content
      expect(injectedContent.indexOf('user_memories')).toBeLessThan(
        injectedContent.indexOf('Second content'),
      );
    });

    it('should work with array content in injection message', async () => {
      const provider = new TestFirstUserContentProvider();
      const context = createContext([
        { content: 'System prompt', role: 'system' },
        {
          content: [{ text: 'Existing injection', type: 'text' }],
          meta: { systemInjection: true },
          role: 'user',
        },
        { content: 'User question', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[1].content[0].text).toBe('Existing injection\n\nTest content');
    });
  });

  describe('edge cases', () => {
    it('should handle empty content gracefully', async () => {
      const provider = new TestFirstUserContentProvider();
      provider.setContent('');

      const context = createContext([{ content: 'User question', role: 'user' }]);

      const result = await provider.process(context);

      // Empty string is falsy, so it should skip injection
      expect(result.messages).toHaveLength(1);
    });

    it('should handle complex message structure', async () => {
      const provider = new TestFirstUserContentProvider();
      const context = createContext([
        { content: 'System prompt', role: 'system' },
        { content: 'First user message', role: 'user' },
        { content: 'Assistant response', role: 'assistant' },
        { content: 'Second user message', role: 'user' },
        { content: 'Another assistant response', role: 'assistant' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(6);
      // Injection should be at index 1, before the first user message
      expect(result.messages[1].content).toBe('Test content');
      expect(result.messages[1].meta?.systemInjection).toBe(true);
      expect(result.messages[2].content).toBe('First user message');
    });
  });
});
