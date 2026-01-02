import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { BaseLastUserContentProvider } from '../BaseLastUserContentProvider';

class TestLastUserContentProvider extends BaseLastUserContentProvider {
  readonly name = 'TestLastUserContentProvider';

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const cloned = this.cloneContext(context);
    const hasExistingWrapper = this.hasExistingSystemContext(cloned);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock('Test content', 'test_context')
      : this.wrapWithSystemContext('Test content', 'test_context');
    this.appendToLastUserMessage(cloned, contentToAppend);
    return cloned;
  }

  // Expose protected methods for testing
  testFindLastUserMessageIndex(messages: any[]) {
    return this.findLastUserMessageIndex(messages);
  }

  testAppendToLastUserMessage(context: PipelineContext, content: string) {
    return this.appendToLastUserMessage(context, content);
  }

  testWrapWithSystemContext(content: string, contextType: string) {
    return this.wrapWithSystemContext(content, contextType);
  }

  testCreateContextBlock(content: string, contextType: string) {
    return this.createContextBlock(content, contextType);
  }

  testHasExistingSystemContext(context: PipelineContext) {
    return this.hasExistingSystemContext(context);
  }
}

// Second provider for testing multiple injections
class SecondLastUserContentProvider extends BaseLastUserContentProvider {
  readonly name = 'SecondLastUserContentProvider';

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const cloned = this.cloneContext(context);
    const hasExistingWrapper = this.hasExistingSystemContext(cloned);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock('Second content', 'second_context')
      : this.wrapWithSystemContext('Second content', 'second_context');
    this.appendToLastUserMessage(cloned, contentToAppend);
    return cloned;
  }
}

describe('BaseLastUserContentProvider', () => {
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

  describe('findLastUserMessageIndex', () => {
    it('should find the last user message in a simple conversation', () => {
      const provider = new TestLastUserContentProvider();
      const messages = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi there', role: 'assistant' },
        { content: 'How are you?', role: 'user' },
        { content: 'I am fine', role: 'assistant' },
      ];

      const index = provider.testFindLastUserMessageIndex(messages);
      expect(index).toBe(2);
    });

    it('should find the last user message when it is at the end', () => {
      const provider = new TestLastUserContentProvider();
      const messages = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi there', role: 'assistant' },
        { content: 'Tell me more', role: 'user' },
      ];

      const index = provider.testFindLastUserMessageIndex(messages);
      expect(index).toBe(2);
    });

    it('should return -1 when no user messages exist', () => {
      const provider = new TestLastUserContentProvider();
      const messages = [
        { content: 'System prompt', role: 'system' },
        { content: 'Assistant response', role: 'assistant' },
      ];

      const index = provider.testFindLastUserMessageIndex(messages);
      expect(index).toBe(-1);
    });

    it('should return -1 for empty messages array', () => {
      const provider = new TestLastUserContentProvider();
      const index = provider.testFindLastUserMessageIndex([]);
      expect(index).toBe(-1);
    });

    it('should find the only user message', () => {
      const provider = new TestLastUserContentProvider();
      const messages = [{ content: 'Only user message', role: 'user' }];

      const index = provider.testFindLastUserMessageIndex(messages);
      expect(index).toBe(0);
    });
  });

  describe('appendToLastUserMessage', () => {
    it('should append content to string message content', () => {
      const provider = new TestLastUserContentProvider();
      const context = createContext([
        { content: 'Hello', role: 'user' },
        { content: 'Hi', role: 'assistant' },
        { content: 'Tell me more', role: 'user' },
      ]);

      const result = provider.testAppendToLastUserMessage(context, 'Appended content');

      expect(result.messages[2].content).toBe('Tell me more\n\nAppended content');
    });

    it('should append content to array message content with text part', () => {
      const provider = new TestLastUserContentProvider();
      const context = createContext([
        {
          content: [
            { text: 'Hello', type: 'text' },
            { image_url: { url: 'http://example.com/image.png' }, type: 'image_url' },
          ],
          role: 'user',
        },
      ]);

      const result = provider.testAppendToLastUserMessage(context, 'Appended content');

      expect(result.messages[0].content[0].text).toBe('Hello\n\nAppended content');
      expect(result.messages[0].content[1].type).toBe('image_url');
    });

    it('should add new text part when array content has no text part', () => {
      const provider = new TestLastUserContentProvider();
      const context = createContext([
        {
          content: [{ image_url: { url: 'http://example.com/image.png' }, type: 'image_url' }],
          role: 'user',
        },
      ]);

      const result = provider.testAppendToLastUserMessage(context, 'Appended content');

      expect(result.messages[0].content).toHaveLength(2);
      expect(result.messages[0].content[1]).toEqual({
        text: 'Appended content',
        type: 'text',
      });
    });

    it('should not modify context when no user messages exist', () => {
      const provider = new TestLastUserContentProvider();
      const context = createContext([{ content: 'System message', role: 'system' }]);

      const result = provider.testAppendToLastUserMessage(context, 'Appended content');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('System message');
    });

    it('should append to last text part in multimodal message', () => {
      const provider = new TestLastUserContentProvider();
      const context = createContext([
        {
          content: [
            { image_url: { url: 'http://example.com/image1.png' }, type: 'image_url' },
            { text: 'First text', type: 'text' },
            { image_url: { url: 'http://example.com/image2.png' }, type: 'image_url' },
            { text: 'Last text', type: 'text' },
          ],
          role: 'user',
        },
      ]);

      const result = provider.testAppendToLastUserMessage(context, 'Appended content');

      // Should append to the last text part (index 3)
      expect(result.messages[0].content[3].text).toBe('Last text\n\nAppended content');
      expect(result.messages[0].content[1].text).toBe('First text');
    });
  });

  describe('wrapWithSystemContext', () => {
    it('should wrap content with system context markers', () => {
      const provider = new TestLastUserContentProvider();
      const result = provider.testWrapWithSystemContext('Test content', 'test_type');

      expect(result).toContain('<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->');
      expect(result).toContain('<context.instruction>');
      expect(result).toContain('</context.instruction>');
      expect(result).toContain('<test_type>');
      expect(result).toContain('Test content');
      expect(result).toContain('</test_type>');
      expect(result).toContain('<!-- END SYSTEM CONTEXT -->');
    });

    it('should include instruction text', () => {
      const provider = new TestLastUserContentProvider();
      const result = provider.testWrapWithSystemContext('Content', 'type');

      expect(result).toContain(
        'following part contains context information injected by the system',
      );
      expect(result).toContain('Always prioritize handling user-visible content');
      expect(result).toContain('the context is only required when user');
    });

    it('should handle different context types', () => {
      const provider = new TestLastUserContentProvider();

      const result1 = provider.testWrapWithSystemContext('Content 1', 'current_page_context');
      expect(result1).toContain('<current_page_context>');
      expect(result1).toContain('</current_page_context>');

      const result2 = provider.testWrapWithSystemContext('Content 2', 'files_info');
      expect(result2).toContain('<files_info>');
      expect(result2).toContain('</files_info>');
    });
  });

  describe('process integration', () => {
    it('should process and append content to last user message', async () => {
      const provider = new TestLastUserContentProvider();
      const context = createContext([
        { content: 'Hello', role: 'user' },
        { content: 'Hi', role: 'assistant' },
        { content: 'Question', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages[2].content).toContain('Question');
      expect(result.messages[2].content).toContain('<!-- SYSTEM CONTEXT');
      expect(result.messages[2].content).toContain('<test_context>');
      expect(result.messages[2].content).toContain('Test content');
    });

    it('should not modify messages when no user messages exist', async () => {
      class NoOpProvider extends BaseLastUserContentProvider {
        readonly name = 'NoOpProvider';

        protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
          const cloned = this.cloneContext(context);
          const lastUserIndex = this.findLastUserMessageIndex(cloned.messages);

          if (lastUserIndex === -1) {
            return cloned;
          }

          this.appendToLastUserMessage(cloned, 'Content');
          return cloned;
        }
      }

      const provider = new NoOpProvider();
      const context = createContext([{ content: 'System', role: 'system' }]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('System');
    });
  });

  describe('multiple providers injection', () => {
    it('should have only one SYSTEM CONTEXT wrapper when two providers inject content', async () => {
      const provider1 = new TestLastUserContentProvider();
      const provider2 = new SecondLastUserContentProvider();

      const context = createContext([{ content: 'User question', role: 'user' }]);

      // First provider injects
      const result1 = await provider1.process(context);
      // Second provider injects into the result of first
      const result2 = await provider2.process(result1);

      const finalContent = result2.messages[0].content as string;

      // Verify exact content structure
      expect(finalContent).toBe(`User question

<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<test_context>
Test content
</test_context>
<second_context>
Second content
</second_context>
<!-- END SYSTEM CONTEXT -->`);
    });

    it('should correctly detect existing system context', () => {
      const provider = new TestLastUserContentProvider();

      const contextWithWrapper = createContext([
        {
          content: `Question

<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>...</context.instruction>
<existing_context>content</existing_context>
<!-- END SYSTEM CONTEXT -->`,
          role: 'user',
        },
      ]);

      const contextWithoutWrapper = createContext([{ content: 'Simple question', role: 'user' }]);

      expect(provider.testHasExistingSystemContext(contextWithWrapper)).toBe(true);
      expect(provider.testHasExistingSystemContext(contextWithoutWrapper)).toBe(false);
    });

    it('should work with array content when multiple providers inject', async () => {
      const provider1 = new TestLastUserContentProvider();
      const provider2 = new SecondLastUserContentProvider();

      const context = createContext([
        {
          content: [
            { text: 'User question with image', type: 'text' },
            { image_url: { url: 'http://example.com/img.png' }, type: 'image_url' },
          ],
          role: 'user',
        },
      ]);

      const result1 = await provider1.process(context);
      const result2 = await provider2.process(result1);

      const textContent = result2.messages[0].content[0].text;

      // Verify exact content structure for array content
      expect(textContent).toBe(`User question with image

<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<test_context>
Test content
</test_context>
<second_context>
Second content
</second_context>
<!-- END SYSTEM CONTEXT -->`);
    });
  });

  describe('createContextBlock', () => {
    it('should create context block without wrapper', () => {
      const provider = new TestLastUserContentProvider();
      const result = provider.testCreateContextBlock('Block content', 'block_type');

      expect(result).toBe(`<block_type>
Block content
</block_type>`);
    });
  });
});
