import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { ContextSelectionsInjector } from '../ContextSelectionsInjector';

describe('ContextSelectionsInjector', () => {
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

  describe('enabled/disabled', () => {
    it('should skip injection when disabled', async () => {
      const injector = new ContextSelectionsInjector({ enabled: false });

      const context = createContext([
        {
          content: 'Question',
          metadata: {
            contextSelections: [
              {
                content: 'Selected text',
                id: 'text-1',
                source: 'text',
              },
            ],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content).toBe('Question');
      expect(result.metadata.ContextSelectionsInjectorInjectedCount).toBeUndefined();
    });

    it('should inject text context selections independently from legacy page selections', async () => {
      const injector = new ContextSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'What does this mean?',
          metadata: {
            contextSelections: [
              {
                content: '脚踢自学习',
                id: 'text-1',
                source: 'text',
                title: '脚踢自学习',
              },
            ],
            pageSelections: [
              {
                content: 'Legacy page selection',
                id: 'page-1',
                pageId: 'page-1',
                xml: '<p>Legacy page selection</p>',
              },
            ],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content).toContain('What does this mean?');
      expect(result.messages[0].content).toContain('<user_context_selections>');
      expect(result.messages[0].content).toContain('source="text"');
      expect(result.messages[0].content).toContain('脚踢自学习');
      expect(result.messages[0].content).not.toContain('<user_page_selections>');
      expect(result.messages[0].content).not.toContain('Legacy page selection');
      expect(result.metadata.ContextSelectionsInjectorInjectedCount).toBe(1);
    });
  });

  describe('page selections', () => {
    it('distinguishes an exact phrase selection from the containing block', async () => {
      const injector = new ContextSelectionsInjector({ enabled: true });
      const result = await injector.process(
        createContext([
          {
            content: 'Rewrite only the selection',
            metadata: {
              contextSelections: [
                {
                  content: 'a<b\n  and c>d',
                  id: 'sel-1',
                  pageId: 'page-1',
                  source: 'page',
                  xml: '<p id="ab12">Before a&lt;b and c&gt;d after</p>',
                },
              ],
            },
            role: 'user',
          },
        ]),
      );

      expect(result.messages[0].content).toContain(
        '<selected_text>a&lt;b\n  and c&gt;d</selected_text>',
      );
      expect(result.messages[0].content).toContain('<containing_blocks>');
      expect(result.messages[0].content).toContain(
        '<p id="ab12">Before a&lt;b and c&gt;d after</p>',
      );
    });
    it('injects a page selection as its LiteXML, node ids included', async () => {
      const injector = new ContextSelectionsInjector({ enabled: true });

      const result = await injector.process(
        createContext([
          {
            content: 'Rewrite this',
            metadata: {
              contextSelections: [
                {
                  content: 'Pricing starts at $10',
                  id: 'sel-1',
                  pageId: 'page-1',
                  source: 'page',
                  xml: '<p id="ab12"><span id="cd34">Pricing starts at $10</span></p>',
                },
              ],
            },
            role: 'user',
          },
        ]),
      );

      expect(result.messages[0].content).toContain(
        '<p id="ab12"><span id="cd34">Pricing starts at $10</span></p>',
      );
      expect(result.messages[0].content).toContain('source="page"');
    });

    it('falls back to legacy pageSelections on messages saved before contextSelections', async () => {
      const injector = new ContextSelectionsInjector({ enabled: true });

      const result = await injector.process(
        createContext([
          {
            content: 'Shorten this',
            metadata: {
              pageSelections: [
                {
                  content: 'A long legacy paragraph',
                  id: 'sel-1',
                  pageId: 'page-1',
                  xml: '<p id="ab12">A long legacy paragraph</p>',
                },
              ],
            },
            role: 'user',
          },
        ]),
      );

      expect(result.messages[0].content).toContain('<p id="ab12">A long legacy paragraph</p>');
      expect(result.messages[0].content).toContain('source="page"');
    });
  });

  describe('context sources', () => {
    it('should inject code context selections with source metadata', async () => {
      const injector = new ContextSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'Review this code',
          metadata: {
            contextSelections: [
              {
                content: 'const value = 1;',
                filePath: 'src/example.ts',
                id: 'code-1',
                lineRange: { endLine: 12, startLine: 12 },
                source: 'code',
              },
            ],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content).toContain('Review this code');
      expect(result.messages[0].content).toContain('<user_context_selections>');
      expect(result.messages[0].content).toContain('filePath="src/example.ts"');
      expect(result.messages[0].content).toContain('lines="12-12"');
      expect(result.messages[0].content).toContain('const value = 1;');
    });
  });
});
