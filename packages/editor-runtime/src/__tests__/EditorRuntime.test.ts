import type { IEditor } from '@lobehub/editor';
import { CommonPlugin, Kernel, LitexmlPlugin, MarkdownPlugin, moment } from '@lobehub/editor';
import { resetRandomKey } from 'lexical';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorRuntime } from '../EditorRuntime';

describe('EditorRuntime', () => {
  let runtime: EditorRuntime;
  let editor: IEditor;
  let mockTitleSetter: ReturnType<typeof vi.fn>;
  let mockTitleGetter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetRandomKey();
    editor = new Kernel() as unknown as IEditor;
    editor.registerPlugins([CommonPlugin, MarkdownPlugin, LitexmlPlugin]);
    editor.initNodeEditor();

    runtime = new EditorRuntime();
    runtime.setEditor(editor);

    mockTitleSetter = vi.fn();
    mockTitleGetter = vi.fn().mockReturnValue('Test Title');
    runtime.setTitleHandlers(mockTitleSetter, mockTitleGetter);
  });

  describe('initPage', () => {
    it('should initialize document from markdown and verify editor state', async () => {
      const inputMarkdown = 'Hello world\n\nThis is a paragraph.';
      const result = await runtime.initPage({ markdown: inputMarkdown });
      await moment();

      // Verify result
      expect(result.nodeCount).toBeGreaterThanOrEqual(0);
      expect(result.extractedTitle).toBeUndefined();

      // Verify editor state - full text match (editor adds trailing space)
      const editorMarkdown = editor.getDocument('markdown') as unknown as string;
      expect(editorMarkdown).toBe('Hello world\n\nThis is a paragraph. \n\n');

      // Verify XML structure
      const editorXml = editor.getDocument('litexml') as unknown as string;
      expect(editorXml).toMatch(/<root>.*<p id="[^"]+"[^>]*>.*Hello world.*<\/p>.*<\/root>/s);
    });

    it('should extract title from markdown heading and set content without title', async () => {
      const result = await runtime.initPage({
        markdown: '# My Document Title\n\nThis is the content.',
      });
      await moment();

      // Verify title extraction
      expect(result.extractedTitle).toBe('My Document Title');
      expect(mockTitleSetter).toHaveBeenCalledWith('My Document Title');

      // Verify editor state - only content without title (editor adds trailing space)
      const editorMarkdown = editor.getDocument('markdown') as unknown as string;
      expect(editorMarkdown).toBe('This is the content. \n\n');
    });

    it('should handle markdown with multiple headings', async () => {
      const result = await runtime.initPage({
        markdown: '# Main Title\n\n## Section 1\n\nContent here.\n\n## Section 2\n\nMore content.',
      });
      await moment();

      // Verify title extraction (only first h1)
      expect(result.extractedTitle).toBe('Main Title');

      // Verify editor state - content after title extraction (editor adds trailing space)
      const editorMarkdown = editor.getDocument('markdown') as unknown as string;
      expect(editorMarkdown).toBe(
        '## Section 1\n\nContent here. \n\n## Section 2\n\nMore content. \n\n',
      );
    });

    it('should throw error when editor is not initialized', async () => {
      runtime.setEditor(null);

      await expect(runtime.initPage({ markdown: 'Test' })).rejects.toThrow(
        'Editor not initialized',
      );
    });
  });

  describe('editTitle', () => {
    it('should update title and return previous and new title', async () => {
      const result = await runtime.editTitle({ title: 'New Title' });

      expect(result.previousTitle).toBe('Test Title');
      expect(result.newTitle).toBe('New Title');
      expect(mockTitleSetter).toHaveBeenCalledWith('New Title');
    });

    it('should throw error when title handlers are not set', async () => {
      runtime.setTitleHandlers(null, null);

      await expect(runtime.editTitle({ title: 'New Title' })).rejects.toThrow(
        'Title handlers not initialized',
      );
    });
  });

  describe('getPageContent', () => {
    beforeEach(async () => {
      await runtime.initPage({
        markdown: '# Test Document\n\nThis is **bold** and *italic* text.',
      });
      await moment();
    });

    it('should return markdown content', async () => {
      const result = await runtime.getPageContent({ format: 'markdown' });

      expect(result.markdown).toBeDefined();
      expect(result.markdown).toContain('bold');
      expect(result.xml).toBeUndefined();
    });

    it('should return xml content', async () => {
      const result = await runtime.getPageContent({ format: 'xml' });

      expect(result.xml).toBeDefined();
      expect(result.xml).toContain('id=');
      expect(result.markdown).toBeUndefined();
    });

    it('should return both formats by default', async () => {
      const result = await runtime.getPageContent({ format: 'both' });

      expect(result.markdown).toBeDefined();
      expect(result.xml).toBeDefined();
    });

    it('should include metadata', async () => {
      const result = await runtime.getPageContent({ format: 'both' });

      expect(result.title).toBe('Test Title');
      expect(result.charCount).toBeGreaterThan(0);
      expect(result.lineCount).toBeGreaterThan(0);
    });
  });

  describe('modifyNodes', () => {
    beforeEach(async () => {
      editor.setDocument('markdown', '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n\n');
      await moment();
    });

    describe('insert', () => {
      it('should insert single node after existing node', async () => {
        const xmlBefore = editor.getDocument('litexml') as unknown as string;
        const idMatch = /id="([^"]+)"/.exec(xmlBefore);
        const existingId = idMatch ? idMatch[1] : 'root';

        const result = await runtime.modifyNodes({
          operations: [
            {
              action: 'insert',
              afterId: existingId,
              litexml: '<p>New inserted paragraph</p>',
            },
          ],
        });
        await moment();

        expect(result.successCount).toBe(1);
        expect(result.totalCount).toBe(1);
        expect(result.results[0].action).toBe('insert');
        expect(result.results[0].success).toBe(true);

        const markdown = editor.getDocument('markdown') as unknown as string;
        expect(markdown).toMatchSnapshot();
      });

      it('should insert multiple nodes after same node', async () => {
        const xmlBefore = editor.getDocument('litexml') as unknown as string;
        const idMatch = /id="([^"]+)"/.exec(xmlBefore);
        const existingId = idMatch ? idMatch[1] : 'root';

        const result = await runtime.modifyNodes({
          operations: [
            { action: 'insert', afterId: existingId, litexml: '<p>Insert 1</p>' },
            { action: 'insert', afterId: existingId, litexml: '<p>Insert 2</p>' },
            { action: 'insert', afterId: existingId, litexml: '<p>Insert 3</p>' },
          ],
        });
        await moment();

        expect(result.successCount).toBe(3);
        expect(result.totalCount).toBe(3);

        const markdown = editor.getDocument('markdown') as unknown as string;
        expect(markdown).toMatchSnapshot();
      });
    });

    describe('modify', () => {
      it('should modify existing node content', async () => {
        const xmlBefore = editor.getDocument('litexml') as unknown as string;
        const paragraphMatch = /<p id="([^"]+)"/.exec(xmlBefore);
        const paragraphId = paragraphMatch![1];

        const result = await runtime.modifyNodes({
          operations: [
            {
              action: 'modify',
              litexml: `<p id="${paragraphId}">Modified content here</p>`,
            },
          ],
        });
        await moment();

        expect(result.successCount).toBe(1);
        expect(result.results[0].action).toBe('modify');

        const markdown = editor.getDocument('markdown') as unknown as string;
        expect(markdown).toMatchSnapshot();
      });

      it('should modify multiple nodes at once', async () => {
        const xmlBefore = editor.getDocument('litexml') as unknown as string;
        const paragraphMatches = [...xmlBefore.matchAll(/<p id="([^"]+)"/g)];

        if (paragraphMatches.length >= 2) {
          const result = await runtime.modifyNodes({
            operations: [
              {
                action: 'modify',
                litexml: [
                  `<p id="${paragraphMatches[0][1]}">Modified first</p>`,
                  `<p id="${paragraphMatches[1][1]}">Modified second</p>`,
                ],
              },
            ],
          });
          await moment();

          expect(result.successCount).toBe(1);

          const markdown = editor.getDocument('markdown') as unknown as string;
          expect(markdown).toMatchSnapshot();
        }
      });
    });

    describe('remove', () => {
      it('should remove existing node', async () => {
        const xmlBefore = editor.getDocument('litexml') as unknown as string;
        const paragraphMatch = /<p id="([^"]+)"/.exec(xmlBefore);
        const paragraphId = paragraphMatch![1];

        const result = await runtime.modifyNodes({
          operations: [
            {
              action: 'remove',
              id: paragraphId,
            },
          ],
        });
        await moment();

        expect(result.successCount).toBe(1);
        expect(result.results[0].action).toBe('remove');

        const markdownAfter = editor.getDocument('litexml') as unknown as string;
        expect(markdownAfter).toMatchSnapshot();
      });

      it('should remove multiple nodes', async () => {
        const xmlBefore = editor.getDocument('litexml') as unknown as string;
        const paragraphMatches = [...xmlBefore.matchAll(/<p id="([^"]+)"/g)];

        if (paragraphMatches.length >= 2) {
          const result = await runtime.modifyNodes({
            operations: [
              { action: 'remove', id: paragraphMatches[0][1] },
              { action: 'remove', id: paragraphMatches[1][1] },
            ],
          });
          await moment();

          expect(result.successCount).toBe(2);

          const xml = editor.getDocument('markdown') as unknown as string;
          expect(xml).toMatchSnapshot();
        }
      });
    });

    describe('mixed operations', () => {
      it('should handle insert, modify, and remove in single call', async () => {
        const xmlBefore = editor.getDocument('litexml') as unknown as string;
        const idMatch = /id="([^"]+)"/.exec(xmlBefore);
        const existingId = idMatch ? idMatch[1] : 'root';

        const result = await runtime.modifyNodes({
          operations: [
            { action: 'insert', afterId: existingId, litexml: '<p>New content</p>' },
            { action: 'modify', litexml: `<h1 id="${existingId}">Updated title</h1>` },
          ],
        });
        await moment();

        expect(result.totalCount).toBe(2);

        const markdown = editor.getDocument('markdown') as unknown as string;
        expect(markdown).toMatchSnapshot();
      });
    });

    describe('error handling', () => {
      it('should throw error when no operations provided', async () => {
        await expect(
          runtime.modifyNodes({
            // @ts-expect-error - Testing invalid input
            operations: undefined,
          }),
        ).rejects.toThrow('No operations provided');
      });

      it('should normalize single operation to array', async () => {
        const xmlBefore = editor.getDocument('litexml') as unknown as string;
        const idMatch = /id="([^"]+)"/.exec(xmlBefore);
        const existingId = idMatch ? idMatch[1] : 'root';

        const result = await runtime.modifyNodes({
          // @ts-expect-error - Testing LLM edge case
          operations: { action: 'insert', afterId: existingId, litexml: '<p>Single op</p>' },
        });
        await moment();

        expect(result.successCount).toBe(1);

        const markdown = editor.getDocument('markdown') as unknown as string;
        expect(markdown).toMatchSnapshot();
      });
    });
  });

  describe('replaceText', () => {
    beforeEach(async () => {
      editor.setDocument(
        'markdown',
        'Hello world. This is a test. Hello again. Testing the world.\n\n',
      );
      await moment();
    });

    it('should replace all occurrences by default', async () => {
      const result = await runtime.replaceText({
        searchText: 'Hello',
        newText: 'Hi',
      });
      await moment();

      expect(result.replacementCount).toBe(2);
      expect(result.modifiedNodeIds.length).toBeGreaterThan(0);

      const markdown = editor.getDocument('markdown') as unknown as string;
      expect(markdown).toMatchSnapshot();
    });

    it('should replace first occurrence only when replaceAll is false', async () => {
      const result = await runtime.replaceText({
        searchText: 'Hello',
        newText: 'Hi',
        replaceAll: false,
      });
      await moment();

      expect(result.replacementCount).toBe(1);
    });

    it('should support regex patterns with optional groups', async () => {
      const result = await runtime.replaceText({
        searchText: 'test(ing)?',
        newText: 'demo',
        useRegex: true,
      });
      await moment();

      expect(result.replacementCount).toBeGreaterThan(0);

      const markdown = editor.getDocument('markdown') as unknown as string;
      expect(markdown).toMatchSnapshot();
    });

    it('should support regex with word boundaries', async () => {
      const result = await runtime.replaceText({
        searchText: '\\bworld\\b',
        newText: 'universe',
        useRegex: true,
      });
      await moment();

      expect(result.replacementCount).toBe(2);

      const markdown = editor.getDocument('markdown') as unknown as string;
      expect(markdown).toMatchSnapshot();
    });

    it('should support regex with character classes', async () => {
      editor.setDocument('markdown', 'User123 and User456 are online.\n\n');
      await moment();

      const result = await runtime.replaceText({
        searchText: 'User\\d+',
        newText: 'Guest',
        useRegex: true,
      });
      await moment();

      expect(result.replacementCount).toBe(2);

      const markdown = editor.getDocument('markdown') as unknown as string;
      expect(markdown).toMatchSnapshot();
    });

    it('should support regex with quantifiers', async () => {
      editor.setDocument('markdown', 'Hellooo world! Helloooooo again!\n\n');
      await moment();

      const result = await runtime.replaceText({
        searchText: 'Hello+',
        newText: 'Hi',
        useRegex: true,
      });
      await moment();

      expect(result.replacementCount).toBe(2);

      const markdown = editor.getDocument('markdown') as unknown as string;
      expect(markdown).toMatchSnapshot();
    });

    it('should support regex with alternation', async () => {
      const result = await runtime.replaceText({
        searchText: 'Hello|world',
        newText: 'X',
        useRegex: true,
      });
      await moment();

      expect(result.replacementCount).toBe(4);

      const markdown = editor.getDocument('markdown') as unknown as string;
      expect(markdown).toMatchSnapshot();
    });

    it('should support regex first occurrence only', async () => {
      const result = await runtime.replaceText({
        searchText: 'Hello|world',
        newText: 'X',
        useRegex: true,
        replaceAll: false,
      });
      await moment();

      expect(result.replacementCount).toBe(1);

      const markdown = editor.getDocument('markdown') as unknown as string;
      expect(markdown).toMatchSnapshot();
    });

    it('should return zero replacements when no match found', async () => {
      const result = await runtime.replaceText({
        searchText: 'nonexistent',
        newText: 'replacement',
      });

      expect(result.replacementCount).toBe(0);
      expect(result.modifiedNodeIds).toEqual([]);
    });

    it('should throw error for invalid regex pattern', async () => {
      await expect(
        runtime.replaceText({
          searchText: '[invalid',
          newText: 'replacement',
          useRegex: true,
        }),
      ).rejects.toThrow('Invalid regex pattern');
    });

    it('should replace within specific nodes when nodeIds provided', async () => {
      const xml = editor.getDocument('litexml') as unknown as string;
      const nodeIdMatch = /<p id="([^"]+)"/.exec(xml);

      if (nodeIdMatch) {
        const result = await runtime.replaceText({
          searchText: 'world',
          newText: 'universe',
          nodeIds: [nodeIdMatch[1]],
        });
        await moment();

        // Should only replace in specified node
        expect(result.modifiedNodeIds.length).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('document ID management', () => {
    it('should set and get current document ID', () => {
      runtime.setCurrentDocId('doc-123');
      expect(runtime.getCurrentDocId()).toBe('doc-123');
    });

    it('should return undefined when no document ID is set', () => {
      const newRuntime = new EditorRuntime();
      expect(newRuntime.getCurrentDocId()).toBeUndefined();
    });

    it('should include document ID in getPageContent result', async () => {
      runtime.setCurrentDocId('my-doc-id');
      await runtime.initPage({ markdown: 'Test content' });
      await moment();

      const result = await runtime.getPageContent({ format: 'markdown' });
      expect(result.documentId).toBe('my-doc-id');
    });
  });

  describe('getPageContentContext', () => {
    beforeEach(async () => {
      await runtime.initPage({ markdown: 'Test content for context' });
      await moment();
    });

    it('should return context with markdown only', () => {
      const context = runtime.getPageContentContext('markdown');

      expect(context.markdown).toBeDefined();
      expect(context.xml).toBeUndefined();
      expect(context.metadata.title).toBe('Test Title');
    });

    it('should return context with xml only', () => {
      const context = runtime.getPageContentContext('xml');

      expect(context.xml).toBeDefined();
      expect(context.markdown).toBeUndefined();
    });

    it('should return context with both formats', () => {
      const context = runtime.getPageContentContext('both');

      expect(context.markdown).toBeDefined();
      expect(context.xml).toBeDefined();
      expect(context.metadata.charCount).toBeGreaterThan(0);
      expect(context.metadata.lineCount).toBeGreaterThan(0);
    });

    it('should default to both formats', () => {
      const context = runtime.getPageContentContext();

      expect(context.markdown).toBeDefined();
      expect(context.xml).toBeDefined();
    });
  });
});
