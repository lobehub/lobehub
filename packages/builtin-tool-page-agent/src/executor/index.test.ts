import type { EditorRuntime } from '@lobechat/editor-runtime';
import type { BuiltinToolContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PageAgentIdentifier } from '../types';
import { PageAgentExecutor } from './index';

describe('PageAgentExecutor', () => {
  let executor: PageAgentExecutor;
  let mockRuntime: EditorRuntime;
  const mockContext = {} as BuiltinToolContext;

  beforeEach(() => {
    // Create mock runtime with all methods
    mockRuntime = {
      editTitle: vi.fn(),
      getPageContent: vi.fn(),
      initPage: vi.fn(),
      modifyNodes: vi.fn(),
      replaceText: vi.fn(),
    } as unknown as EditorRuntime;

    executor = new PageAgentExecutor(mockRuntime);
  });

  describe('constructor and basic properties', () => {
    it('should have correct identifier', () => {
      expect(executor.identifier).toBe(PageAgentIdentifier);
    });

    it('should have all API methods registered', () => {
      expect(executor.hasApi('initPage')).toBe(true);
      expect(executor.hasApi('editTitle')).toBe(true);
      expect(executor.hasApi('getPageContent')).toBe(true);
      expect(executor.hasApi('modifyNodes')).toBe(true);
      expect(executor.hasApi('replaceText')).toBe(true);
    });

    it('should return false for non-existent API', () => {
      expect(executor.hasApi('nonExistentApi')).toBe(false);
    });
  });

  describe('initPage', () => {
    it('should format result with extracted title', async () => {
      vi.mocked(mockRuntime.initPage).mockResolvedValue({
        extractedTitle: 'My Document',
        nodeCount: 5,
      });

      const result = await executor.initPage({ markdown: '# My Document\n\nContent' });

      expect(result.success).toBe(true);
      expect(result.content).toBe(
        'Document initialized with 5 nodes. Title "My Document" extracted and set.',
      );
      expect(result.state).toEqual({
        nodeCount: 5,
        rootId: 'root',
      });
    });

    it('should format result without extracted title', async () => {
      vi.mocked(mockRuntime.initPage).mockResolvedValue({
        extractedTitle: undefined,
        nodeCount: 3,
      });

      const result = await executor.initPage({ markdown: 'Just content' });

      expect(result.success).toBe(true);
      expect(result.content).toBe('Document initialized with 3 nodes.');
    });

    it('should handle errors', async () => {
      vi.mocked(mockRuntime.initPage).mockRejectedValue(new Error('Editor not initialized'));

      const result = await executor.initPage({ markdown: 'content' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Editor not initialized');
      expect(result.error?.type).toBe('PluginServerError');
    });
  });

  describe('editTitle', () => {
    it('should format title change result', async () => {
      vi.mocked(mockRuntime.editTitle).mockResolvedValue({
        newTitle: 'New Title',
        previousTitle: 'Old Title',
      });

      const result = await executor.editTitle({ title: 'New Title' });

      expect(result.success).toBe(true);
      expect(result.content).toBe('Title changed from "Old Title" to "New Title".');
      expect(result.state).toEqual({
        newTitle: 'New Title',
        previousTitle: 'Old Title',
      });
    });

    it('should handle errors', async () => {
      vi.mocked(mockRuntime.editTitle).mockRejectedValue(new Error('Title handlers not set'));

      const result = await executor.editTitle({ title: 'New Title' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Title handlers not set');
    });
  });

  describe('getPageContent', () => {
    it('should format result with markdown content', async () => {
      vi.mocked(mockRuntime.getPageContent).mockResolvedValue({
        charCount: 100,
        documentId: 'doc-123',
        lineCount: 10,
        markdown: '# Title\n\nContent here',
        title: 'My Document',
        xml: undefined,
      });

      const result = await executor.getPageContent({ format: 'markdown' });

      expect(result.success).toBe(true);
      expect(result.content).toBe('# Title\n\nContent here');
      expect(result.state).toEqual({
        documentId: 'doc-123',
        markdown: '# Title\n\nContent here',
        metadata: {
          fileType: 'document',
          title: 'My Document',
          totalCharCount: 100,
          totalLineCount: 10,
        },
        xml: undefined,
      });
    });

    it('should format result with XML content', async () => {
      vi.mocked(mockRuntime.getPageContent).mockResolvedValue({
        charCount: 50,
        documentId: 'doc-123',
        lineCount: 5,
        markdown: undefined,
        title: 'My Document',
        xml: '<p id="1">Content</p>',
      });

      const result = await executor.getPageContent({ format: 'xml' });

      expect(result.success).toBe(true);
      expect(result.content).toBe('<p id="1">Content</p>');
    });

    it('should handle errors', async () => {
      vi.mocked(mockRuntime.getPageContent).mockRejectedValue(new Error('Editor not initialized'));

      const result = await executor.getPageContent({ format: 'both' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Editor not initialized');
    });
  });

  describe('modifyNodes', () => {
    it('should format successful operations result', async () => {
      vi.mocked(mockRuntime.modifyNodes).mockResolvedValue({
        results: [
          { action: 'insert', success: true },
          { action: 'modify', success: true },
          { action: 'remove', success: true },
        ],
        successCount: 3,
        totalCount: 3,
      });

      const result = await executor.modifyNodes({
        operations: [
          { action: 'insert', afterId: 'node1', litexml: '<p>New</p>' },
          { action: 'modify', litexml: '<p id="node2">Updated</p>' },
          { action: 'remove', id: 'node3' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('1 insert');
      expect(result.content).toContain('1 modify');
      expect(result.content).toContain('1 remove');
      expect(result.content).toContain('3/3 operations succeeded');
    });

    it('should format partial success result', async () => {
      vi.mocked(mockRuntime.modifyNodes).mockResolvedValue({
        results: [
          { action: 'insert', success: true },
          { action: 'modify', error: 'Node not found', success: false },
        ],
        successCount: 1,
        totalCount: 2,
      });

      const result = await executor.modifyNodes({
        operations: [
          { action: 'insert', afterId: 'node1', litexml: '<p>New</p>' },
          { action: 'modify', litexml: '<p id="invalid">Updated</p>' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('1/2 operations succeeded');
    });

    it('should return success false when all operations fail', async () => {
      vi.mocked(mockRuntime.modifyNodes).mockResolvedValue({
        results: [{ action: 'modify', error: 'Node not found', success: false }],
        successCount: 0,
        totalCount: 1,
      });

      const result = await executor.modifyNodes({
        operations: [{ action: 'modify', litexml: '<p id="invalid">Updated</p>' }],
      });

      expect(result.success).toBe(false);
    });

    it('should handle errors', async () => {
      vi.mocked(mockRuntime.modifyNodes).mockRejectedValue(new Error('No operations provided'));

      const result = await executor.modifyNodes({ operations: [] });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('No operations provided');
    });
  });

  describe('replaceText', () => {
    it('should format successful replacement result', async () => {
      vi.mocked(mockRuntime.replaceText).mockResolvedValue({
        modifiedNodeIds: ['node1', 'node2'],
        replacementCount: 5,
      });

      const result = await executor.replaceText({ newText: 'new', searchText: 'old' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Successfully replaced 5 occurrence(s)');
      expect(result.content).toContain('"old"');
      expect(result.content).toContain('"new"');
      expect(result.content).toContain('Modified 2 node(s)');
      expect(result.state).toEqual({
        modifiedNodeIds: ['node1', 'node2'],
        replacementCount: 5,
      });
    });

    it('should format result with nodeIds filter', async () => {
      vi.mocked(mockRuntime.replaceText).mockResolvedValue({
        modifiedNodeIds: ['node1'],
        replacementCount: 2,
      });

      const result = await executor.replaceText({
        newText: 'new',
        nodeIds: ['node1', 'node2'],
        searchText: 'old',
      });

      expect(result.content).toContain('within 2 specified node(s)');
    });

    it('should format no matches result', async () => {
      vi.mocked(mockRuntime.replaceText).mockResolvedValue({
        modifiedNodeIds: [],
        replacementCount: 0,
      });

      const result = await executor.replaceText({ newText: 'new', searchText: 'notfound' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('No occurrences of "notfound" found');
    });

    it('should handle errors', async () => {
      vi.mocked(mockRuntime.replaceText).mockRejectedValue(
        new Error('Invalid regex pattern: [invalid'),
      );

      const result = await executor.replaceText({
        newText: 'new',
        searchText: '[invalid',
        useRegex: true,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid regex');
    });
  });

  describe('invoke method', () => {
    it('should invoke the correct method based on apiName', async () => {
      vi.mocked(mockRuntime.editTitle).mockResolvedValue({
        newTitle: 'New',
        previousTitle: 'Old',
      });

      const result = await executor.invoke('editTitle', { title: 'New' }, mockContext);

      expect(result.success).toBe(true);
      expect(mockRuntime.editTitle).toHaveBeenCalledWith({ title: 'New' });
    });

    it('should return error for unknown API', async () => {
      const result = await executor.invoke('unknownApi', {}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('ApiNotFound');
    });
  });
});
