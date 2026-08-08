import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { PageSelectionsInjector } from '../PageSelectionsInjector';

describe('PageSelectionsInjector', () => {
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

  const createPageSelection = (id: string, xmlContent: string, pageId = 'page-1') => ({
    content: xmlContent, // preview content
    id,
    pageId,
    xml: xmlContent, // actual content used by formatPageSelections
  });

  describe('enabled/disabled', () => {
    it('should skip injection when disabled', async () => {
      const injector = new PageSelectionsInjector({ enabled: false });

      const context = createContext([
        {
          content: 'Question',
          metadata: {
            pageSelections: [createPageSelection('sel-1', 'Selected text')],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content).toBe('Question');
      expect(result.metadata.PageSelectionsInjectorInjectedCount).toBeUndefined();
    });

    it('should inject when enabled', async () => {
      const injector = new PageSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'Question',
          metadata: {
            pageSelections: [createPageSelection('sel-1', 'Selected text')],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content).toContain('Question');
      expect(result.messages[0].content).toContain('<user_page_selections>');
      expect(result.messages[0].content).toContain('Selected text');
    });
  });

  describe('injection to every user message', () => {
    it('should inject selections to each user message that has them', async () => {
      const injector = new PageSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'First question',
          metadata: {
            pageSelections: [createPageSelection('sel-1', 'First selection')],
          },
          role: 'user',
        },
        { content: 'First answer', role: 'assistant' },
        {
          content: 'Second question',
          metadata: {
            pageSelections: [createPageSelection('sel-2', 'Second selection')],
          },
          role: 'user',
        },
        { content: 'Second answer', role: 'assistant' },
        {
          content: 'Third question without selection',
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      // First user message should have first selection
      expect(result.messages[0].content).toContain('First question');
      expect(result.messages[0].content).toContain('First selection');
      expect(result.messages[0].content).toContain('<user_page_selections>');

      // Second user message should have second selection
      expect(result.messages[2].content).toContain('Second question');
      expect(result.messages[2].content).toContain('Second selection');
      expect(result.messages[2].content).toContain('<user_page_selections>');

      // Third user message should NOT have injection (no selections)
      expect(result.messages[4].content).toBe('Third question without selection');

      // Assistant messages should be unchanged
      expect(result.messages[1].content).toBe('First answer');
      expect(result.messages[3].content).toBe('Second answer');

      // Metadata should show 2 injections
      expect(result.metadata.PageSelectionsInjectorInjectedCount).toBe(2);
    });

    it('should skip user messages without pageSelections', async () => {
      const injector = new PageSelectionsInjector({ enabled: true });

      const context = createContext([
        { content: 'No selections here', role: 'user' },
        { content: 'Answer', role: 'assistant' },
        {
          content: 'With selections',
          metadata: {
            pageSelections: [createPageSelection('sel-1', 'Some text')],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content).toBe('No selections here');
      expect(result.messages[2].content).toContain('With selections');
      expect(result.messages[2].content).toContain('Some text');
    });

    it('should skip user messages with empty pageSelections array', async () => {
      const injector = new PageSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'Empty selections',
          metadata: { pageSelections: [] },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content).toBe('Empty selections');
    });
  });

  describe('SYSTEM CONTEXT wrapper', () => {
    it('should wrap selection content with SYSTEM CONTEXT markers', async () => {
      const injector = new PageSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'Question',
          metadata: {
            pageSelections: [createPageSelection('sel-1', 'Selected text')],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);
      const content = result.messages[0].content as string;

      expect(content).toContain('<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->');
      expect(content).toContain('<context.instruction>');
      expect(content).toContain('<user_page_selections>');
      expect(content).toContain('</user_page_selections>');
      expect(content).toContain('<!-- END SYSTEM CONTEXT -->');
    });

    it('should have only one SYSTEM CONTEXT wrapper per message even with multiple selections', async () => {
      const injector = new PageSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'Question',
          metadata: {
            pageSelections: [
              createPageSelection('sel-1', 'First selection'),
              createPageSelection('sel-2', 'Second selection'),
            ],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);
      const content = result.messages[0].content as string;

      const startCount = (content.match(/<!-- SYSTEM CONTEXT/g) || []).length;
      const endCount = (content.match(/<!-- END SYSTEM CONTEXT/g) || []).length;

      expect(startCount).toBe(1);
      expect(endCount).toBe(1);
    });

    it('should create separate SYSTEM CONTEXT wrappers for each user message', async () => {
      const injector = new PageSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'First question',
          metadata: {
            pageSelections: [createPageSelection('sel-1', 'First selection')],
          },
          role: 'user',
        },
        { content: 'Answer', role: 'assistant' },
        {
          content: 'Second question',
          metadata: {
            pageSelections: [createPageSelection('sel-2', 'Second selection')],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      // Each user message should have its own SYSTEM CONTEXT wrapper
      const firstContent = result.messages[0].content as string;
      const secondContent = result.messages[2].content as string;

      expect(firstContent).toContain('<!-- SYSTEM CONTEXT');
      expect(firstContent).toContain('First selection');

      expect(secondContent).toContain('<!-- SYSTEM CONTEXT');
      expect(secondContent).toContain('Second selection');
    });
  });

  describe('multimodal messages', () => {
    it('should handle array content with text parts', async () => {
      const injector = new PageSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: [
            { text: 'Question with image', type: 'text' },
            { image_url: { url: 'http://example.com/img.png' }, type: 'image_url' },
          ],
          metadata: {
            pageSelections: [createPageSelection('sel-1', 'Selected text')],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content[0].text).toContain('Question with image');
      expect(result.messages[0].content[0].text).toContain('Selected text');
      expect(result.messages[0].content[0].text).toContain('<user_page_selections>');
      expect(result.messages[0].content[1]).toEqual({
        image_url: { url: 'http://example.com/img.png' },
        type: 'image_url',
      });
    });
  });

  describe('integration with PageEditorContextInjector', () => {
    it('should create wrapper that PageEditorContextInjector can reuse', async () => {
      const injector = new PageSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'Question about the page',
          metadata: {
            pageSelections: [createPageSelection('sel-1', 'Selected paragraph')],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);
      const content = result.messages[0].content as string;

      // Verify the wrapper structure is correct for reuse
      expect(content).toContain('<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->');
      expect(content).toContain('<context.instruction>');
      expect(content).toContain('<!-- END SYSTEM CONTEXT -->');

      // Verify the content is in the right position (between instruction and end marker)
      const instructionIndex = content.indexOf('</context.instruction>');
      const selectionsIndex = content.indexOf('<user_page_selections>');
      const endIndex = content.indexOf('<!-- END SYSTEM CONTEXT -->');

      expect(instructionIndex).toBeLessThan(selectionsIndex);
      expect(selectionsIndex).toBeLessThan(endIndex);
    });
  });

  describe('metadata', () => {
    it('should set metadata when injections are made', async () => {
      const injector = new PageSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'Question',
          metadata: {
            pageSelections: [createPageSelection('sel-1', 'Text')],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.metadata.PageSelectionsInjectorInjectedCount).toBe(1);
    });

    it('should not set metadata when no injections are made', async () => {
      const injector = new PageSelectionsInjector({ enabled: true });

      const context = createContext([{ content: 'No selections', role: 'user' }]);

      const result = await injector.process(context);

      expect(result.metadata.PageSelectionsInjectorInjectedCount).toBeUndefined();
    });
  });
});
