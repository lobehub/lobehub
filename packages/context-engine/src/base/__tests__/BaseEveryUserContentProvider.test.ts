import { describe, expect, it } from 'vitest';

import type { Message, PipelineContext } from '../../types';
import { BaseEveryUserContentProvider } from '../BaseEveryUserContentProvider';

class TestEveryUserContentProvider extends BaseEveryUserContentProvider {
  readonly name = 'TestEveryUserContentProvider';

  constructor(
    private contentBuilder?: (
      message: Message,
      index: number,
      isLastUser: boolean,
    ) => { content: string; contextType: string } | null,
  ) {
    super();
  }

  protected buildContentForMessage(
    message: Message,
    index: number,
    isLastUser: boolean,
  ): { content: string; contextType: string } | null {
    if (this.contentBuilder) {
      return this.contentBuilder(message, index, isLastUser);
    }
    // Default: inject content for every user message
    return {
      content: `Content for message ${index}`,
      contextType: 'test_context',
    };
  }

  // Expose protected methods for testing
  testHasSystemContextWrapper(content: string | any[]) {
    return this.hasSystemContextWrapper(content);
  }

  testWrapWithSystemContext(content: string, contextType: string) {
    return this.wrapWithSystemContext(content, contextType);
  }

  testCreateContextBlock(content: string, contextType: string) {
    return this.createContextBlock(content, contextType);
  }

  testAppendToMessage(message: Message, content: string, contextType: string) {
    return this.appendToMessage(message, content, contextType);
  }

  testFindLastUserMessageIndex(messages: Message[]) {
    return this.findLastUserMessageIndex(messages);
  }
}

describe('BaseEveryUserContentProvider', () => {
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
    it('should find the last user message', () => {
      const provider = new TestEveryUserContentProvider();
      const messages = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi', role: 'assistant' },
        { content: 'Question', role: 'user' },
        { content: 'Answer', role: 'assistant' },
      ];

      expect(provider.testFindLastUserMessageIndex(messages)).toBe(2);
    });

    it('should return -1 when no user messages exist', () => {
      const provider = new TestEveryUserContentProvider();
      const messages = [{ content: 'System', role: 'system' }];

      expect(provider.testFindLastUserMessageIndex(messages)).toBe(-1);
    });
  });

  describe('hasSystemContextWrapper', () => {
    it('should detect existing system context wrapper in string content', () => {
      const provider = new TestEveryUserContentProvider();

      const withWrapper = `Question
<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<test>content</test>
<!-- END SYSTEM CONTEXT -->`;

      const withoutWrapper = 'Simple question';

      expect(provider.testHasSystemContextWrapper(withWrapper)).toBe(true);
      expect(provider.testHasSystemContextWrapper(withoutWrapper)).toBe(false);
    });

    it('should detect existing system context wrapper in array content', () => {
      const provider = new TestEveryUserContentProvider();

      const withWrapper = [
        {
          text: `Question
<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<test>content</test>
<!-- END SYSTEM CONTEXT -->`,
          type: 'text',
        },
      ];

      const withoutWrapper = [{ text: 'Simple question', type: 'text' }];

      expect(provider.testHasSystemContextWrapper(withWrapper)).toBe(true);
      expect(provider.testHasSystemContextWrapper(withoutWrapper)).toBe(false);
    });
  });

  describe('wrapWithSystemContext', () => {
    it('should wrap content with system context markers', () => {
      const provider = new TestEveryUserContentProvider();
      const result = provider.testWrapWithSystemContext('Test content', 'test_type');

      expect(result).toContain('<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->');
      expect(result).toContain('<context.instruction>');
      expect(result).toContain('<test_type>');
      expect(result).toContain('Test content');
      expect(result).toContain('</test_type>');
      expect(result).toContain('<!-- END SYSTEM CONTEXT -->');
    });
  });

  describe('createContextBlock', () => {
    it('should create context block without wrapper', () => {
      const provider = new TestEveryUserContentProvider();
      const result = provider.testCreateContextBlock('Block content', 'block_type');

      expect(result).toBe(`<block_type>
Block content
</block_type>`);
    });
  });

  describe('appendToMessage', () => {
    it('should append with new wrapper to string content without existing wrapper', () => {
      const provider = new TestEveryUserContentProvider();
      const message: Message = { content: 'Original question', role: 'user' };

      const result = provider.testAppendToMessage(message, 'New content', 'new_type');

      expect(result.content).toContain('Original question');
      expect(result.content).toContain('<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->');
      expect(result.content).toContain('<new_type>');
      expect(result.content).toContain('New content');
      expect(result.content).toContain('<!-- END SYSTEM CONTEXT -->');
    });

    it('should insert into existing wrapper in string content', () => {
      const provider = new TestEveryUserContentProvider();
      const message: Message = {
        content: `Original question

<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>...</context.instruction>
<existing_type>
Existing content
</existing_type>
<!-- END SYSTEM CONTEXT -->`,
        role: 'user',
      };

      const result = provider.testAppendToMessage(message, 'New content', 'new_type');

      // Should have only one SYSTEM CONTEXT wrapper
      const content = result.content as string;
      const startCount = (content.match(/<!-- SYSTEM CONTEXT/g) || []).length;
      const endCount = (content.match(/<!-- END SYSTEM CONTEXT/g) || []).length;

      expect(startCount).toBe(1);
      expect(endCount).toBe(1);
      expect(content).toContain('<existing_type>');
      expect(content).toContain('<new_type>');
      expect(content).toContain('New content');
    });

    it('should handle array content without existing wrapper', () => {
      const provider = new TestEveryUserContentProvider();
      const message: Message = {
        content: [
          { text: 'Original question', type: 'text' },
          { image_url: { url: 'http://example.com/img.png' }, type: 'image_url' },
        ],
        role: 'user',
      };

      const result = provider.testAppendToMessage(message, 'New content', 'new_type');

      expect(result.content[0].text).toContain('Original question');
      expect(result.content[0].text).toContain('<!-- SYSTEM CONTEXT');
      expect(result.content[0].text).toContain('<new_type>');
      expect(result.content[1].type).toBe('image_url');
    });

    it('should add new text part when array content has no text part', () => {
      const provider = new TestEveryUserContentProvider();
      const message: Message = {
        content: [{ image_url: { url: 'http://example.com/img.png' }, type: 'image_url' }],
        role: 'user',
      };

      const result = provider.testAppendToMessage(message, 'New content', 'new_type');

      expect(result.content).toHaveLength(2);
      expect(result.content[1].type).toBe('text');
      expect(result.content[1].text).toContain('<!-- SYSTEM CONTEXT');
      expect(result.content[1].text).toContain('New content');
    });
  });

  describe('process integration', () => {
    it('should inject content to all user messages', async () => {
      const provider = new TestEveryUserContentProvider();
      const context = createContext([
        { content: 'First question', role: 'user' },
        { content: 'First answer', role: 'assistant' },
        { content: 'Second question', role: 'user' },
        { content: 'Second answer', role: 'assistant' },
        { content: 'Third question', role: 'user' },
      ]);

      const result = await provider.process(context);

      // All user messages should have content injected
      expect(result.messages[0].content).toContain('First question');
      expect(result.messages[0].content).toContain('<test_context>');
      expect(result.messages[0].content).toContain('Content for message 0');

      expect(result.messages[2].content).toContain('Second question');
      expect(result.messages[2].content).toContain('<test_context>');
      expect(result.messages[2].content).toContain('Content for message 2');

      expect(result.messages[4].content).toContain('Third question');
      expect(result.messages[4].content).toContain('<test_context>');
      expect(result.messages[4].content).toContain('Content for message 4');

      // Assistant messages should be unchanged
      expect(result.messages[1].content).toBe('First answer');
      expect(result.messages[3].content).toBe('Second answer');
    });

    it('should correctly identify isLastUser parameter', async () => {
      const isLastUserCalls: boolean[] = [];

      const provider = new TestEveryUserContentProvider((message, index, isLastUser) => {
        isLastUserCalls.push(isLastUser);
        return { content: `Content ${index}`, contextType: 'test' };
      });

      const context = createContext([
        { content: 'First', role: 'user' },
        { content: 'Answer', role: 'assistant' },
        { content: 'Second', role: 'user' },
        { content: 'Answer', role: 'assistant' },
        { content: 'Third (last)', role: 'user' },
      ]);

      await provider.process(context);

      expect(isLastUserCalls).toEqual([false, false, true]);
    });

    it('should skip injection when buildContentForMessage returns null', async () => {
      const provider = new TestEveryUserContentProvider((message, index) => {
        // Only inject for first user message
        if (index === 0) {
          return { content: 'First only', contextType: 'test' };
        }
        return null;
      });

      const context = createContext([
        { content: 'First question', role: 'user' },
        { content: 'Answer', role: 'assistant' },
        { content: 'Second question', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages[0].content).toContain('<test>');
      expect(result.messages[0].content).toContain('First only');
      expect(result.messages[2].content).toBe('Second question');
    });

    it('should update metadata with injection count', async () => {
      const provider = new TestEveryUserContentProvider();
      const context = createContext([
        { content: 'First', role: 'user' },
        { content: 'Second', role: 'user' },
        { content: 'Third', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.metadata.TestEveryUserContentProviderInjectedCount).toBe(3);
    });

    it('should not set metadata when no injections made', async () => {
      const provider = new TestEveryUserContentProvider(() => null);
      const context = createContext([{ content: 'Question', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.metadata.TestEveryUserContentProviderInjectedCount).toBeUndefined();
    });
  });

  describe('integration with BaseLastUserContentProvider', () => {
    it('should allow BaseLastUserContentProvider to reuse wrapper created by BaseEveryUserContentProvider', async () => {
      // First: BaseEveryUserContentProvider injects to last user message
      const everyProvider = new TestEveryUserContentProvider((message, index, isLastUser) => {
        if (isLastUser) {
          return { content: 'Selection content', contextType: 'user_selections' };
        }
        return null;
      });

      const context = createContext([
        { content: 'First question', role: 'user' },
        { content: 'Answer', role: 'assistant' },
        { content: 'Last question', role: 'user' },
      ]);

      const result = await everyProvider.process(context);

      // The last user message should have a SYSTEM CONTEXT wrapper
      const lastUserContent = result.messages[2].content as string;
      expect(lastUserContent).toContain('<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->');
      expect(lastUserContent).toContain('<user_selections>');
      expect(lastUserContent).toContain('Selection content');
      expect(lastUserContent).toContain('<!-- END SYSTEM CONTEXT -->');

      // Now BaseLastUserContentProvider can detect and reuse this wrapper
      expect(everyProvider.testHasSystemContextWrapper(lastUserContent)).toBe(true);
    });
  });
});
