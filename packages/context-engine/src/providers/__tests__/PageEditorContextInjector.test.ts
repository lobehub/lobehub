import type { PageContentContext } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { PageEditorContextInjector } from '../PageEditorContextInjector';

describe('PageEditorContextInjector', () => {
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

  // Minimal page content context for predictable output
  const createMinimalPageContentContext = (): PageContentContext => ({
    markdown: 'Doc content',
    metadata: {
      title: 'Test Document',
    },
  });

  describe('injection position', () => {
    it('should append context to the last user message', async () => {
      const injector = new PageEditorContextInjector({
        enabled: true,
        pageContentContext: createMinimalPageContentContext(),
      });

      const context = createContext([
        { content: 'First question', role: 'user' },
        { content: 'First answer', role: 'assistant' },
        { content: 'Second question', role: 'user' },
      ]);

      const result = await injector.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].content).toBe('First question');
      expect(result.messages[1].content).toBe('First answer');
      // The last user message should have the context appended
      expect(result.messages[2].content).toContain('Second question');
      expect(result.messages[2].content).toContain('<current_page title="Test Document">');
      expect(result.messages[2].content).toContain('Doc content');
    });

    it('should append to the only user message when there is just one', async () => {
      const injector = new PageEditorContextInjector({
        enabled: true,
        pageContentContext: createMinimalPageContentContext(),
      });

      const context = createContext([{ content: 'Only question', role: 'user' }]);

      const result = await injector.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toContain('Only question');
      expect(result.messages[0].content).toContain('<current_page title="Test Document">');
    });

    it('should inject to last user message when last message is tool', async () => {
      const injector = new PageEditorContextInjector({
        enabled: true,
        pageContentContext: createMinimalPageContentContext(),
      });

      const context = createContext([
        { content: 'First question', role: 'user' },
        { content: 'First answer', role: 'assistant' },
        { content: 'User request to modify', role: 'user' },
        {
          content: 'I will modify the document',
          role: 'assistant',
          tool_calls: [{ id: 'call_1', function: { name: 'modifyNodes', arguments: '{}' } }],
        },
        { content: 'Successfully modified', role: 'tool', tool_call_id: 'call_1' },
      ]);

      const result = await injector.process(context);

      expect(result.messages).toHaveLength(5);
      // First user message should NOT have injection
      expect(result.messages[0].content).toBe('First question');
      // Last user message (index 2) should have the context appended
      expect(result.messages[2].content).toContain('User request to modify');
      expect(result.messages[2].content).toContain('<current_page title="Test Document">');
      // Tool message should remain unchanged
      expect(result.messages[4].content).toBe('Successfully modified');
    });
  });

  describe('injection format with markdown and xml', () => {
    it('should include markdown content in injection', async () => {
      const injector = new PageEditorContextInjector({
        enabled: true,
        pageContentContext: {
          markdown: '# Hello World\n\nThis is content.',
          metadata: {
            charCount: 30,
            lineCount: 3,
            title: 'Hello World',
          },
        },
      });

      const context = createContext([{ content: 'Question', role: 'user' }]);
      const result = await injector.process(context);

      expect(result.messages[0].content).toContain('<markdown chars="30" lines="3">');
      expect(result.messages[0].content).toContain('# Hello World');
      expect(result.messages[0].content).toContain('This is content.');
    });

    it('should include xml structure in injection', async () => {
      const injector = new PageEditorContextInjector({
        enabled: true,
        pageContentContext: {
          metadata: {
            title: 'Test Doc',
          },
          xml: '<root><p id="1">Hello</p></root>',
        },
      });

      const context = createContext([{ content: 'Question', role: 'user' }]);
      const result = await injector.process(context);

      expect(result.messages[0].content).toContain('<doc_xml_structure>');
      expect(result.messages[0].content).toContain('<root><p id="1">Hello</p></root>');
      expect(result.messages[0].content).toContain('</doc_xml_structure>');
    });

    it('should include both markdown and xml when provided', async () => {
      const injector = new PageEditorContextInjector({
        enabled: true,
        pageContentContext: {
          markdown: '# Title\n\nContent here.',
          metadata: {
            charCount: 20,
            lineCount: 3,
            title: 'Full Doc',
          },
          xml: '<root><h1 id="1">Title</h1><p id="2">Content here.</p></root>',
        },
      });

      const context = createContext([{ content: 'Q', role: 'user' }]);
      const result = await injector.process(context);

      expect(result.messages[0].content).toContain('<current_page title="Full Doc">');
      expect(result.messages[0].content).toContain('<markdown');
      expect(result.messages[0].content).toContain('# Title');
      expect(result.messages[0].content).toContain('<doc_xml_structure>');
      expect(result.messages[0].content).toContain('<root>');
    });
  });

  describe('skip conditions', () => {
    it('should skip injection when disabled', async () => {
      const injector = new PageEditorContextInjector({
        enabled: false,
        pageContentContext: createMinimalPageContentContext(),
      });

      const context = createContext([{ content: 'Question', role: 'user' }]);
      const result = await injector.process(context);

      expect(result.messages[0].content).toBe('Question');
      expect(result.metadata.pageEditorContextInjected).toBeUndefined();
    });

    it('should skip injection when pageContentContext is not provided', async () => {
      const injector = new PageEditorContextInjector({
        enabled: true,
      });

      const context = createContext([{ content: 'Question', role: 'user' }]);
      const result = await injector.process(context);

      expect(result.messages[0].content).toBe('Question');
      expect(result.metadata.pageEditorContextInjected).toBeUndefined();
    });

    it('should skip injection when no user messages exist', async () => {
      const injector = new PageEditorContextInjector({
        enabled: true,
        pageContentContext: createMinimalPageContentContext(),
      });

      const context = createContext([{ content: 'System message', role: 'system' }]);
      const result = await injector.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('System message');
    });
  });

  describe('metadata', () => {
    it('should set pageEditorContextInjected metadata to true', async () => {
      const injector = new PageEditorContextInjector({
        enabled: true,
        pageContentContext: createMinimalPageContentContext(),
      });

      const context = createContext([{ content: 'Question', role: 'user' }]);
      const result = await injector.process(context);

      expect(result.metadata.pageEditorContextInjected).toBe(true);
    });
  });

  describe('multimodal messages', () => {
    it('should append to array content with text parts', async () => {
      const injector = new PageEditorContextInjector({
        enabled: true,
        pageContentContext: createMinimalPageContentContext(),
      });

      const context = createContext([
        {
          content: [
            { text: 'User question', type: 'text' },
            { image_url: { url: 'http://example.com/image.png' }, type: 'image_url' },
          ],
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content[0].text).toContain('User question');
      expect(result.messages[0].content[0].text).toContain('<current_page title="Test Document">');
      expect(result.messages[0].content[1]).toEqual({
        image_url: { url: 'http://example.com/image.png' },
        type: 'image_url',
      });
    });
  });
});
